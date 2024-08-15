import { Signal, createEffect, toValue, Component, Effect } from "@rhjs/core";

class ExtensibleFunction extends Function {
  // @ts-ignore
  constructor(f: Function) {
    return Object.setPrototypeOf(f, new.target.prototype);
  }
}
class SignalDefine<T> extends ExtensibleFunction {
  constructor(private signal: Signal<T>, private eff: Effect) {
    super((value: any) => {
      if (value === undefined) {
        return this.signal.get();
      } else if (typeof value === "function") {
        const next = value(this.signal.get());
        this.signal.set(next);
        return next;
      } else {
        this.signal.set(value);
        return value;
      }
    });
  }

  get() {
    return this.signal.get();
  }

  set(value: T) {
    this.signal.set(value);
    return this;
  }

  mutate(fn: (value: T) => T) {
    this.signal.set(fn(this.get()));
    return this;
  }

  provide(key: string) {
    Component.provide(key, this.signal);
    return this;
  }

  inject(key: string) {
    const signal = Component.inject(key);
    createEffect(() => {
      this.signal.set(toValue(signal));
    });
    return this;
  }

  error(onError: (err: any, value: T) => T) {
    if (Component.active) {
      Component.active.onError = (err) => this.set(onError(err, this.get()));
    }
    return this;
  }

  raw() {
    return Signal.toRaw(this.signal.get() as any) as T;
  }

  cleanup(fn: (val: T) => any) {
    Component.onCleanup(() => fn(this.get()));
    return this;
  }

  mount(fn: (val: T) => any) {
    Component.onMount(() => fn(this.get()));
    return this;
  }

  once() {
    this.eff.dispose();
    return this;
  }

  map<U>(fn: (value: T) => U): Def<U> {
    return def(() => fn(this.get()));
  }

  watch(fn: (value: T) => any) {
    const unsub = this.signal.subscribe({
      setter(value) {
        fn(value);
      },
    });
    Component.onCleanup(unsub);
    return this;
  }

  *[Symbol.iterator]() {
    yield () => this.signal.get();
    yield (value) =>
      typeof value === "function" ? this.mutate(value) : this.signal.set(value);
  }
}
const is_promise_like = (value: any): value is PromiseLike<any> =>
  value && typeof value?.then === "function";
function is_plain_object(obj) {
  if (Object.prototype.toString.call(obj) !== "[object Object]") {
    return false;
  }

  let proto = Object.getPrototypeOf(obj);
  return proto === null || proto === Object.prototype;
}

export type Def<T> = Omit<
  SignalDefine<T> & ((val?: ((value: T) => T) | T | undefined) => T),
  keyof Function
> & { [0]: () => T; [1]: (value: T | ((v: T) => T)) => void };

export function def<T>(fn: (...args: any[]) => T): Def<T>;
export function def<T>(sig: Signal<T>): Def<T>;
export function def<T>(promise: PromiseLike<T>): Def<T | null>;
export function def<T extends Record<keyof any, any>>(val: T): Def<T> & T;
export function def<T>(val: T): Def<T>;
export function def(val: any) {
  const sig = new Signal(null as any);
  const eff = createEffect(() => {
    const value = toValue(val);
    if (is_promise_like(value)) {
      value.then(sig.set);
    } else {
      sig.set(value);
    }
  });
  const _define = new SignalDefine(sig, eff);
  if (is_plain_object(val)) {
    return new Proxy(
      {},
      {
        get(target, p, receiver) {
          if (p in _define) {
            return Reflect.get(_define, p, receiver);
          }
          return _define.get()[p];
        },
        set(target, p, newValue, receiver) {
          if (p in _define) {
            return Reflect.set(_define, p, newValue, receiver);
          }
          return (_define.get()[p] = newValue);
        },
      }
    );
  }
  return _define;
}
