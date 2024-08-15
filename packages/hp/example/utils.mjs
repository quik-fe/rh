import { h, toValue, createEffect } from "@rhjs/core";
import htm from "htm";

export const html = htm.bind(h);

export const css = (strings, ...values) => {
  const style = h("style");
  createEffect(() => {
    style.innerHTML = String.raw(strings, ...values.map(toValue));
  });
  return style;
};
