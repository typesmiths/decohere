export function debounce<T extends unknown[]>(
	callback: (...args: T) => Promise<void>,
	delay: number,
) {
	let timeoutTimer: ReturnType<typeof setTimeout>;

	return (...args: T) => {
		clearTimeout(timeoutTimer);
		timeoutTimer = setTimeout(async () => {
			await callback(...args);
		}, delay);
	};
}
