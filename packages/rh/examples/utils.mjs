import { h, toValue, createEffect } from "../dist/main.module.mjs";
import htm from "htm";

export const html = htm.bind(h);

export const css = (strings, ...values) => {
  const style = h("style");
  createEffect(() => {
    style.innerHTML = String.raw(strings, ...values.map(toValue));
  });
  return style;
};
