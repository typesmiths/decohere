import { describe, expect, it } from "vitest";
import { HttpRequest, TransformError, ValidationError } from "../src/routing/anvil.types.js";
import { BooleanPipe, DatePipe, JsonPipe, NumberPipe } from "../src/routing/pipes/pipes.js";
import { RouteArgumentResolve } from "../src/routing/services/route-argument-resolver.js";

describe("BooleanPipe", () => {
	const pipe = new BooleanPipe();

	it("converts query-shaped strings including 1 / 0", () => {
		expect(pipe.transform("true")).toBe(true);
		expect(pipe.transform("FALSE")).toBe(false);
		expect(pipe.transform("1")).toBe(true);
		expect(pipe.transform("0")).toBe(false);
		expect(pipe.transform(1)).toBe(true);
		expect(pipe.transform(0)).toBe(false);
	});

	it("throws ValidationError for unrecognised values", () => {
		expect(() => pipe.transform("yes")).toThrow(ValidationError);
	});
});

describe("NumberPipe", () => {
	const pipe = new NumberPipe();

	it("throws ValidationError for non-numeric strings", () => {
		expect(() => pipe.transform("abc")).toThrow(ValidationError);
	});
});

describe("DatePipe", () => {
	const pipe = new DatePipe();

	it("converts an ISO date string to Date", () => {
		const result = pipe.transform("2024-01-15T00:00:00.000Z");
		expect(result).toBeInstanceOf(Date);
		expect(result.getFullYear()).toBe(2024);
	});

	it("throws ValidationError for an invalid or empty date string", () => {
		expect(() => pipe.transform("not-a-date")).toThrow(ValidationError);
		expect(() => pipe.transform("")).toThrow(ValidationError);
		expect(() => pipe.transform("   ")).toThrow(ValidationError);
	});
});

describe("JsonPipe", () => {
	const pipe = new JsonPipe();

	it("throws TransformError for invalid JSON", () => {
		expect(() => pipe.transform("not json")).toThrow(TransformError);
	});
});

describe("RouteArgumentResolve", () => {
	const resolver = new RouteArgumentResolve();

	it("passes fieldMap types into JsonPipe so Date fields revive", () => {
		const iso = "2024-03-01T00:00:00.000Z";
		const request = new HttpRequest({
			requestId: "r1",
			method: "GET",
			url: "/",
			params: {},
			query: { payload: JSON.stringify({ birthday: iso }) },
			body: {},
		});
		const args = resolver.resolveArguments(request, [
			{
				argumentIndex: 0,
				argumentType: String,
				argumentLocation: "query",
				mappingKey: "payload",
				pipes: [JsonPipe],
				fieldMap: new Map([
					[
						"birthday",
						{
							fieldKey: "birthday",
							fieldType: Date,
							mappingKey: "birthday",
							fieldLocation: "query" as const,
							pipes: [],
						},
					],
				]),
			},
		]);
		expect((args[0] as { birthday: Date }).birthday).toBeInstanceOf(Date);
		expect((args[0] as { birthday: Date }).birthday.toISOString()).toBe(iso);
	});
});
