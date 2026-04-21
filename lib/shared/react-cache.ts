import * as React from "react";

type CacheFn = <T extends (...args: any[]) => any>(fn: T) => T;

const reactCache = (React as unknown as { cache?: CacheFn }).cache;

export const cache: CacheFn =
  typeof reactCache === "function"
    ? reactCache
    : (<T extends (...args: any[]) => any>(fn: T) => fn);
