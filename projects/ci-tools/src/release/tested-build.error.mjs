/** There's no tested build to ship for a commit: no CI run passed for it, or its build is gone. */
export class TestedBuildError extends Error {
	/** @param {string} message */
	constructor(message) {
		super(message);
		this.name = "TestedBuildError";
	}
}
