import { formatUnits } from "@bankable/core";
export const amountLabel = (v: bigint, decimals: number) => formatUnits(v, decimals);
export const utc = (unix: bigint) => new Date(Number(unix) * 1000).toISOString().replace(".000Z", "Z");
export function fragmentParams(): URLSearchParams { return new URLSearchParams(typeof window === "undefined" ? "" : window.location.hash.replace(/^#/, "")); }
