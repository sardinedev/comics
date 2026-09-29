import { expiredSessionResponse } from "@util/mocks/expiredSession.mock";
import { beforeEach, describe, expect, test } from "vitest";
import { $offline, flagIfSessionExpired } from "./offline.store";

beforeEach(() => $offline.setKey("authRequired", false));

describe("flagIfSessionExpired", () => {
	test("asks for sign-in on a confirmed invalid session", () => {
		expect(flagIfSessionExpired(expiredSessionResponse())).toBe(true);
		expect($offline.get().authRequired).toBe(true);
	});

	test("clears the prompt once a request succeeds", () => {
		flagIfSessionExpired(expiredSessionResponse());
		expect(flagIfSessionExpired(new Response(null, { status: 204 }))).toBe(
			false,
		);
		expect($offline.get().authRequired).toBe(false);
	});

	test.each([
		401, 403, 503,
	])("leaves the prompt alone on a bare %s", (status) => {
		flagIfSessionExpired(expiredSessionResponse());
		expect(flagIfSessionExpired(new Response(null, { status }))).toBe(false);
		expect($offline.get().authRequired).toBe(true);
	});
});
