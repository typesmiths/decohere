import { FunctionDecorator } from "./decorator.js";
import { sleep } from "./sleep.js";

export type RetryOptions = {
	attempts?: number;
	delayMs?: number;
	shouldRetry?: (error: unknown) => boolean;
};

class RetryDecorator extends FunctionDecorator<RetryOptions> {
	public decorator(_target: object, _propertyKey: string, descriptor: PropertyDescriptor) {
		const originalMethod = descriptor.value as (...args: unknown[]) => unknown;
		const attempts = Math.max(1, this.options?.attempts ?? 3);
		const delayMs = Math.max(0, this.options?.delayMs ?? 0);
		const shouldRetry = this.options?.shouldRetry ?? (() => true);

		descriptor.value = async function (...args: unknown[]) {
			let lastError: unknown;

			for (let attempt = 1; attempt <= attempts; attempt++) {
				try {
					return await Promise.resolve(originalMethod.apply(this, args));
				} catch (error) {
					lastError = error;
					const shouldAttemptAgain = attempt < attempts && shouldRetry(error);
					if (!shouldAttemptAgain) {
						throw error;
					}

					if (delayMs > 0) {
						await sleep(delayMs);
					}
				}
			}

			throw lastError;
		};

		return descriptor;
	}
}

export const retry = new RetryDecorator().decoratorFactory;
