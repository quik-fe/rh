import {
  Signal,
  toRef,
  Render,
  Component,
  toRaw,
  unref,
  untrack,
  createWatchEffect,
  skip,
} from "@rhjs/core";

type UnwrapSignal<T> = T extends Signal<infer T> ? T : T;
type DeepReadonly<T> = T extends any[]
  ? ReadonlyArray<DeepReadonly<T[number]>>
  : T extends object
  ? { readonly [P in keyof T]: DeepReadonly<T[P]> }
  : T;

type UnRefState<State> = {
  [K in keyof State]: State[K] extends Signal<infer T> ? T : State[K];
};
export type ReadonlyState<State> = DeepReadonly<UnwrapSignal<State>>;

export type Dispatcher<State> = [act: Action<State>, ...args: any[]];
export type UpdateDate<State> = State | Dispatcher<State> | Effector<State>;
export type Action<State> = (
  state: ReadonlyState<State>,
  ...args: any[]
) => UpdateDate<State>;
export type StateSetter<State> = (date: UpdateDate<State>) => void;
export type Dispatch<State> = (fn: Action<State>, ...args: any[]) => void;
export type Effector<State> = [
  state: State,
  eff: Effecter<State>,
  ...args: any[]
];
export type Effecter<State> = (
  dispatch: Dispatch<State>,
  ...args: any[]
) => void;

export type UnSubscriber = () => void;
export type Subscriber<State> = (
  dispatch: Dispatch<State>,
  ...args: any[]
) => UnSubscriber;
export type Subscription<State> = [
  subscriber: Subscriber<State>,
  ...args: any[]
];
export type Subscriptions<State> = (
  state: ReadonlyState<State>
) => Subscription<State>[];

const is_dispatcher = <State>(state: any): state is Dispatcher<State> =>
  Array.isArray(state) && is_func(state[0]);
const is_effector = <State>(state: any): state is Effector<State> =>
  Array.isArray(state) && state[0] && is_obj(state[0]) && is_func(state[1]);

const is_func = (x: any): x is (...args: any[]) => any =>
  typeof x === "function";
const is_obj = (x: any): x is Record<keyof any, any> =>
  typeof x === "object" && x !== null;

export type HyperContext<State> = {
  $: (selector: string) => Element | null;
  $$: (selector: string) => Array<Element>;
  id: (id: string) => string;
  $id: (id: string) => Element | null;
  put: (data: State) => void;
  raw: () => ReadonlyState<State>;
  set: StateSetter<State>;
  act: (
    param0: State | Action<State>,
    ...args: any[]
  ) => (...args: any[]) => void;
  patch: Dispatch<State>;
};

const createUnRefProps = <State extends Record<keyof any, any>>(
  state: State
) => {
  const state_refs = Object.fromEntries(
    Object.entries(state).map(([k, v]) => [k, k !== "children" ? toRef(v) : v])
  );

  const handlers = {
    get(target, p, receiver) {
      const value = Reflect.get(target, p, receiver);
      if (Signal.isSignal(value)) {
        return unref(value);
      }
      return value;
    },
    set(target, p, newValue, receiver) {
      const value = Reflect.get(target, p, receiver);
      if (Signal.isSignal(value)) {
        value.value = newValue;
      } else {
        Reflect.set(target, p, newValue, receiver);
      }
      return true;
    },
  };
  const ref_state = new Proxy(state_refs, handlers as any) as UnRefState<State>;

  return [
    ref_state,
    (data: Partial<UnRefState<State>>) => {
      for (const [k, val] of Object.entries(data)) {
        (ref_state as any)[k] = val;
      }
    },
    () => {
      return Object.fromEntries(
        Object.entries(state_refs).map(([k, v]) => [k, unref(v)])
      );
    },
  ] as const;
};

const err = (msg: string) => {
  throw new Error(msg);
};

export const hyper =
  <State extends Record<keyof any, any>>(
    initStateOrEffector: State | Effector<State>,
    render: (
      state: UnRefState<State> & { children: any[] },
      ctx: HyperContext<State>
    ) => any,
    subscriptions?: Subscription<State> | Subscriptions<State>
  ): Render<Partial<State>> =>
  (props) => {
    const instance = Component.active!;
    const $ = (selectors: any) =>
      instance.frag.anchor.parentNode?.querySelector(selectors);
    const $$ = (selectors: any) =>
      Array.from(
        instance.frag.anchor.parentNode?.querySelectorAll(selectors) || []
      );

    const [init_state, init_effecter, init_effecter_args] = is_effector<State>(
      initStateOrEffector
    )
      ? [
          initStateOrEffector[0],
          initStateOrEffector[1],
          initStateOrEffector.slice(2),
        ]
      : [initStateOrEffector, void 0, []];

    const [state, _put, _raw] = createUnRefProps<State>({
      ...init_state,
      ...props,
    });
    const raw = () => skip(_raw) as ReadonlyState<State>;

    let unsubs = [] as UnSubscriber[];
    const patch_subs = () => {
      unsubs.forEach((unsub) => unsub());
      unsubs = (
        subscriptions
          ? Array.isArray(subscriptions)
            ? [subscriptions]
            : subscriptions(raw())
          : []
      ).map(([subscriber, ...args]) => subscriber(dispatch, ...args));
    };
    const patch_effecter = ([state, eff, ...args]: Effector<State>) => (
      put(state), eff(dispatch, ...args)
    );
    const patch_dispatcher = ([act, ...args]: Dispatcher<State>) =>
      set(act(raw(), ...args));

    const put = (data: Partial<UnRefState<State>>): void =>
      data === raw() ? void 0 : (_put(data), patch_subs());
    const set: StateSetter<State> = (data: UpdateDate<State>) =>
      !Array.isArray(data)
        ? put(data)
        : is_effector<State>(data)
        ? patch_effecter(data)
        : is_dispatcher<State>(data)
        ? patch_dispatcher(data)
        : err("Invalid state update: " + JSON.stringify(data));
    const dispatch: Dispatch<State> = (fn: Action<State>, ...args: any[]) =>
      set(fn(raw(), ...args));
    const action: HyperContext<State>["act"] =
      (p0, ...act_args) =>
      (...s_args) =>
        is_func(p0)
          ? dispatch(p0, ...s_args, ...act_args)
          : (set(p0), act_args.map((x) => (is_func(x) ? x() : void 0)));

    const id = (id: string | number) => `${instance.id}-${id}`;
    const $id = (ids: string | number) => $(`#${id(ids)}`);

    if (init_effecter) {
      init_effecter(dispatch, ...init_effecter_args);
    }

    return () =>
      render(state as any, {
        $,
        $$,
        id,
        $id,
        put,
        raw,
        set,
        act: action,
        patch: dispatch,
      });
  };
