import { expiredSessionResponse } from "@util/mocks/expiredSession.mock";
import { beforeEach, describe, expect, test } from "vitest";
import { $syncAuthRequired, flagIfSessionExpired } from "./offline.store";

beforeEach(() => $syncAuthRequired.set(false));

describe("flagIfSessionExpired", () => {
	test("asks for sign-in on a confirmed invalid session", () => {
		expect(flagIfSessionExpired(expiredSessionResponse())).toBe(true);
		expect($syncAuthRequired.get()).toBe(true);
	});

	test("clears the prompt once a request succeeds", () => {
		flagIfSessionExpired(expiredSessionResponse());
		expect(flagIfSessionExpired(new Response(null, { status: 204 }))).toBe(
			false,
		);
		expect($syncAuthRequired.get()).toBe(false);
	});

	test.each([
		401, 403, 503,
	])("leaves the prompt alone on a bare %s", (status) => {
		flagIfSessionExpired(expiredSessionResponse());
		expect(flagIfSessionExpired(new Response(null, { status }))).toBe(false);
		expect($syncAuthRequired.get()).toBe(true);
	});
});
