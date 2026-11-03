import ms from "ms";

export function describeDuration(milliseconds: number): string {
	return ms(milliseconds);
}
