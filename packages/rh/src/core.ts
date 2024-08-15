import {
  Effect,
  Signal,
  createEffect,
  batch,
  EffectScope,
  Dispose,
  toRaw,
  toValue,
  skip,
} from "@quik-fe/signal";
import { MixScheduler, Priority } from "./scheduler";

type Callback = () => void;

export type Render<
  Props extends Record<keyof any, any> = Record<keyof any, any>
> = {
  (
    props: Props & {
      children?: any[];
    }
  ): any;
};

const scheduler = new MixScheduler();
Dispose.nextTick = (fn) => scheduler.nextTick(fn, Priority.LOW);

function any2node(x: any) {
  if (x instanceof Node) return x;
  if (x === null || x === undefined) return null;
  return document.createTextNode(x);
}

function _normalize(children: any) {
  if (children === null || children === undefined) {
    return [];
  }
  if (!Array.isArray(children)) {
    children = [children];
  }
  return children
    .flat()
    .map(toRaw)
    .map((x) => (typeof x === "function" ? h(x) : x))
    .map((x) => (x instanceof Signal ? h(() => x.value) : x))
    .map(any2node)
    .flat()
    .filter((x) => x !== null && x !== undefined);
}

function toRawValue(x: any) {
  const val = toRaw(toValue(x));
  if (Array.isArray(val)) {
    return val.map(toRawValue);
  }
  if (val && typeof val === "object") {
    return Object.fromEntries(
      Object.entries(val).map(([k, v]) => [k, toRawValue(v)])
    );
  }
  return val;
}

const IS_NON_DIMENSIONAL =
  /acit|ex(?:s|g|n|p|$)|rph|grid|ows|mnc|ntw|ine[ch]|zoo|^ord|itera/i;

function setStyle(style: CSSStyleDeclaration, key: string, value: any) {
  if (key[0] === "-") {
    style.setProperty(key, value == null ? "" : value);
  } else if (value == null) {
    style[key] = "";
  } else if (typeof value != "number" || IS_NON_DIMENSIONAL.test(key)) {
    style[key] = value;
  } else {
    style[key] = value + "px";
  }
}

function boolean(value: any) {
  if (value == null) return false;
  if (typeof value === "boolean") return value;
  if (value.toLowerCase() === "true") return true;
  if (value.toLowerCase() === "false") return false;
  if (Number(value) === 0) return false;
  if (Number(value) === 1) return true;
  return Boolean(value);
}

const setAttribute = (element: any, key: string, value: any) => {
  switch (key.toLowerCase()) {
    case "ref":
      if (typeof value === "function") {
        value(element);
      } else if ("value" in value) {
        value.value = element;
      }
      break;
    case "maxLength".toLowerCase():
      element.maxLength = value;
      break;
    case "selected":
    case "value":
      element.value = value;
      break;
    case "defaultValue".toLowerCase():
      element.defaultValue = value;
      break;
    case "checked":
    case "disabled":
    case "hidden":
    case "required":
      element[key] = boolean(value);
      break;
    case "readonly":
      element.readOnly = boolean(value);
      break;
    case "type":
      element.type = value ?? "";
      break;
    case "name":
      element.name = value ?? "";
      break;
    case "src":
      element.src = value ?? "";
      break;
    case "alt":
      element.alt = value ?? "";
      break;
    case "title":
      element.title = value ?? "";
      break;
    case "dangerouslySetInnerHTML".toLowerCase():
      element.innerHTML = value?.__html ?? "";
      break;
    case "dataset":
      if (typeof value === "object") {
        Object.entries(value).forEach(([k, v]) => {
          element.dataset[k] = v;
        });
      }
      break;
    case "style":
      let old_styles = element.__props_styles ?? "";
      if (typeof value === "string") {
        element.style.cssText = value;
        element.__props_styles = value;
      } else if (typeof value === "object") {
        if (typeof old_styles === "string") {
          element.style.cssText = "";
          old_styles = {};
        }
        const keys = Array.from(
          new Set([...Object.keys(old_styles), ...Object.keys(value)])
        );
        keys.forEach((k) => {
          const ov = old_styles[k];
          const nv = value[k];
          if (ov !== nv) {
            setStyle(element.style, k, nv);
            old_styles[k] = nv;
          }
          if (!(k in value)) {
            delete old_styles[k];
          }
        });
        element.__props_styles = { ...old_styles };
      } else {
        console.error("invalid style value", value);
      }
      break;
    case "className".toLowerCase():
    case "class":
      if (typeof value === "string") {
        element.className = value;
      } else if (Array.isArray(value)) {
        element.className = value.join(" ");
      } else if (typeof value === "object") {
        Object.entries(value).forEach(([k, v]) => {
          if (v) {
            element.classList.add(k);
          } else {
            element.classList.remove(k);
          }
        });
      }
      break;
    default:
      if (key.startsWith("data-")) {
        element.dataset[key.slice(5)] = value;
        return;
      }
      element.setAttribute(key, value);
  }
};

const bindEvent = (element: EventTarget, key: string, value: any) => {
  const event = key.slice(2);
  element.addEventListener(event, value, {
    signal: Component.active?.dispose.signal,
  });
  Component.active?.cleanups.push(() =>
    element.removeEventListener(event, value)
  );
};

export function h<P extends Record<keyof any, any>>(
  render: Render<P>,
  props?: P & { children: any[] },
  ...children: any[]
): Text;
export function h<K extends keyof HTMLElementTagNameMap>(
  type: K,
  props?: any,
  ...children: any[]
): HTMLElementTagNameMap[K];
export function h(type: string, props?: any, ...children: any[]): HTMLElement;
export function h(
  type: any,
  props = {} as Record<keyof any, any>,
  ...children: any[]
) {
  props ||= {};
  children = props.children ?? children;
  delete props.children;

  if (typeof type === "function") {
    const comp = new Component(type);
    scheduler.nextTick(() => {
      comp.render({
        ...props,
        children,
      });
    });
    return comp.frag.frag;
  }
  const is_valid_type =
    type instanceof EventTarget ||
    type instanceof Node ||
    type instanceof String ||
    typeof type === "string";
  if (!is_valid_type) {
    throw new Error(`invalid type: ${type}`);
  }

  const element =
    type instanceof EventTarget ? type : document.createElement(type as any);
  // bind on EventTarget
  Object.entries(props ?? {})
    .filter(([key, value]) => key.startsWith("on"))
    .forEach(([key, value]) => {
      key = key.toLowerCase();
      bindEvent(element, key, (...args) => batch(() => value(...args)));
    });

  if (!(element instanceof Node)) {
    if (children.length > 0) {
      throw new Error(`invalid children: ${children}, type is not a Node`);
    }
    return null;
  }
  Object.entries(props ?? {})
    .filter(([key, value]) => !key.startsWith("on"))
    .forEach(([key, value]) => {
      key = key.toLowerCase();
      const maybe_eff =
        ["object", "function"].includes(typeof value) && value !== null;
      if (!maybe_eff) {
        scheduler.nextTick(() => {
          setAttribute(element, key, value);
        });
        return;
      }
      const eff = createEffect(() => {
        const val = toRawValue(value);
        scheduler.nextTick(() => {
          setAttribute(element, key, val);
        });
      });
      const cleanup = () => {
        eff.cleanup();
        eff.stop();
        eff.dispose();
      };
      if (eff.hygienic) {
        scheduler.nextTick(() => {
          cleanup();
        }, Priority.LOW);
        return;
      }
      Component.active?.cleanups.push(cleanup);
    });

  children = children
    .map(_normalize)
    .flat()
    .filter((x) => x !== null && x !== undefined);
  for (const child of children) {
    if (child instanceof Node) {
      element.appendChild(child);
    } else {
      throw new Error("invalid children");
    }
  }
  return element;
}

type WithFrag = {
  _frag: Fragment;
};

export class Fragment {
  anchor = document.createTextNode("") as WithFrag & Text;
  frag = document.createDocumentFragment() as WithFrag & DocumentFragment;

  children = [] as (Node & WithFrag)[];

  constructor(public _component: Component) {
    this.frag.appendChild(this.anchor);
    this.frag._frag = this;
    this.anchor._frag = this;
  }

  setChildren(children) {
    if (!this.anchor.parentNode) {
      return;
    }
    if (!Array.isArray(children)) {
      children = [children];
    }
    const is_text_update =
      children.length === 1 &&
      (children[0] instanceof Text || typeof children[0] === "string") &&
      this.children.length === 1 &&
      (this.children[0] instanceof Text ||
        typeof this.children[0] === "string");
    if (is_text_update) {
      const text = children[0].textContent ?? children[0] ?? "";
      if (this.children[0].textContent !== text)
        this.children[0].textContent = text;
      this.flush();
      return;
    }
    this.children = _normalize(children);
    this.flush();
  }

  // move all to this.frag
  virtual() {
    this.frag.appendChild(this.anchor);
    this.flush(true);
  }

  flush(virtual = false) {
    const temp_frag = document.createDocumentFragment();

    for (const child of this.children) {
      if (child instanceof Node) {
        temp_frag.appendChild(child);
      } else {
        throw new Error("invalid children");
      }
      if (virtual) {
        if (child._frag instanceof Fragment) {
          child._frag.virtual();
        }
      }
    }

    const target = this.anchor.parentNode;
    target?.insertBefore(temp_frag, this.anchor);
  }

  remove() {
    for (const child of this.children) {
      if (child._frag instanceof Fragment) {
        child._frag.remove();
      } else if (child instanceof Element) {
        child.remove();
      } else if (child instanceof Node) {
        child.parentNode?.removeChild(child);
      } else {
        throw new Error("invalid children");
      }
    }
  }

  destroy() {
    this.remove();
    this.anchor.remove();
  }

  /**
   *
   * @param {HTMLElement} target
   * @param {null | Node} ref
   * @param {'before' | 'after'} position
   */
  moveTo(target, ref, position = "before") {
    if (ref && !target.contains(ref)) {
      throw new Error("ref is not a child of target");
    }
    if (position === "before") {
      target.insertBefore(this.anchor, ref ?? null);
    } else {
      target.insertBefore(this.anchor, ref?.nextSibling ?? null);
    }
    this.flush();
  }
}

export class Component {
  static active = null as Component | null;
  static onCleanup(fn: Callback) {
    Component.active?.cleanups.push(fn);
  }
  static onError(fn: Callback) {
    if (!Component.active) return;
    Component.active.onError = fn;
  }
  static onMount(fn: Callback) {
    if (!Component.active) return;
    if (Component.active.onMount) return;
    Component.active.onMount = fn;
    fn();
  }
  static provide(key: string, value: any) {
    if (!Component.active) return;
    Component.active.context[key] = value;
  }
  static inject(key: string) {
    let current = Component.active;
    while (current) {
      if (key in current.context) {
        return current.context[key];
      }
      current = current.parent;
    }
    return null;
  }

  id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

  frag = new Fragment(this);
  props = {} as Record<keyof any, any>;

  cleanups = [] as Callback[];

  parent = Component.active;
  // sub components
  children = [] as Component[];

  scope = new EffectScope();

  version = Date.now();

  context = {} as Record<string, any>;

  onError = (error) => {
    this.parent?.onError(error);
    if (!this.parent) {
      console.error(error);
    }
  };

  onMount = null as Callback | null;

  dispose = new AbortController();

  inited = false;

  _render: Render;

  renderer: Effect;

  constructor(render: Render) {
    this._render = render;
    this.parent?.children.push(this);

    this.renderer = new Effect(() => {
      const last_active = Component.active;
      Component.active = this;
      try {
        this.version = Date.now();
        this.cleanup();
        let children;
        if (this.inited) {
          children = skip(() => render(this.props));
        } else {
          children = this.scope.run(() => render(this.props));
          this.inited = true;
        }
        this.frag.remove();
        this.frag.setChildren(children);
      } catch (error) {
        this.onError(error);
      } finally {
        Component.active = last_active;
      }
    });
  }

  is_old_tree() {
    let parent = this.parent;
    while (parent) {
      if (parent.version > this.version) return true;
      parent = parent.parent;
    }
    return false;
  }

  render(props = this.props) {
    if (this.is_old_tree()) {
      scheduler.nextTick(() => this.destroy(), Priority.LOW);
      return;
    }
    this.props = props;
    if (this.inited) {
      this.renderer.fn();
    } else {
      this.renderer.run();
    }
    return this.frag.frag;
  }

  cleanup() {
    this.cleanups.forEach((fn) => scheduler.nextTick(fn, Priority.LOW));
    this.cleanups = [];
    this.children.forEach((sub) =>
      scheduler.nextTick(() => sub.cleanup(), Priority.LOW)
    );
    this.children = [];
    this.scope.cleanup();
  }

  destroy() {
    this.cleanup();
    this.frag.destroy();
    this.renderer.cleanup();
    this.renderer.stop();
    this.renderer.dispose();
    this.scope.dispose();
    this.dispose.abort();
  }
}
