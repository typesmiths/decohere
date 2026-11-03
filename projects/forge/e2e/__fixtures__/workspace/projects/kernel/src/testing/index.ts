// Never imported by the app: its dependency must not reach the packaged output.
import { expect } from "vitest";

export const assertTrue = (value: boolean) => expect(value).toBe(true);
