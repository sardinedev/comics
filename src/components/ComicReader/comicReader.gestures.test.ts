import { describe, expect, test } from "vitest";
import {
	clampZoomTranslation,
	classifySwipe,
	getContainedImageRect,
	getHalfPageZoomTarget,
	getHorizontalPanEdge,
	getPointZoomRegion,
	getTapZone,
	getZoomBounds,
	isDoublePageSpread,
	isDoubleTap,
	isTapGesture,
} from "./comicReader.gestures";
import type { GesturePoint, ImageMetrics } from "./comicReader.types";

function point(x: number, y: number, time = 0): GesturePoint {
	return { x, y, time };
}

const spreadMetrics: ImageMetrics = {
	container: { width: 400, height: 800 },
	natural: { width: 2000, height: 1000 },
};

describe("comicReader gestures", () => {
	test("classifies tap zones by horizontal thirds", () => {
		expect(getTapZone(20, 300)).toBe("previous");
		expect(getTapZone(150, 300)).toBe("controls");
		expect(getTapZone(280, 300)).toBe("next");
	});

	test("classifies zoom regions by page half", () => {
		expect(getPointZoomRegion(99, 200)).toBe("left");
		expect(getPointZoomRegion(100, 200)).toBe("right");
	});

	test("detects taps and double taps with movement and timing thresholds", () => {
		expect(isTapGesture(point(10, 10), point(18, 16))).toBe(true);
		expect(isTapGesture(point(10, 10), point(40, 10))).toBe(false);
		expect(isDoubleTap(point(100, 100, 100), point(110, 105, 350))).toBe(true);
		expect(isDoubleTap(point(100, 100, 100), point(110, 105, 500))).toBe(false);
		expect(isDoubleTap(point(100, 100, 100), point(180, 105, 200))).toBe(false);
	});

	test("classifies horizontal swipes and rejects small or vertical gestures", () => {
		expect(classifySwipe(point(200, 200), point(120, 210))).toBe("next");
		expect(classifySwipe(point(120, 200), point(210, 195))).toBe("previous");
		expect(classifySwipe(point(120, 200), point(150, 195))).toBe(null);
		expect(classifySwipe(point(120, 200), point(210, 320))).toBe(null);
	});

	test("calculates contained image dimensions", () => {
		expect(
			getContainedImageRect(
				{ width: 400, height: 800 },
				{ width: 2000, height: 1000 },
			),
		).toEqual({
			x: 0,
			y: 300,
			width: 400,
			height: 200,
		});
	});

	test("detects double-page spreads conservatively", () => {
		expect(isDoublePageSpread({ width: 2000, height: 1000 })).toBe(true);
		expect(isDoublePageSpread({ width: 1000, height: 1500 })).toBe(false);
	});

	test("zooms toward the requested half of a spread", () => {
		const left = getHalfPageZoomTarget(spreadMetrics, "left");
		const right = getHalfPageZoomTarget(spreadMetrics, "right");

		expect(left.scale).toBe(2);
		expect(left.translateX).toBe(200);
		expect(right.translateX).toBe(-200);
	});

	test("clamps pan translation within visible image bounds", () => {
		const bounds = getZoomBounds(spreadMetrics, 2);

		expect(clampZoomTranslation(999, 999, bounds)).toEqual({
			translateX: 200,
			translateY: 0,
		});
		expect(clampZoomTranslation(-999, -999, bounds)).toEqual({
			translateX: -200,
			translateY: 0,
		});
	});

	test("reports horizontal pan edges", () => {
		const bounds = getZoomBounds(spreadMetrics, 2);

		expect(getHorizontalPanEdge(199, bounds)).toBe("left");
		expect(getHorizontalPanEdge(-199, bounds)).toBe("right");
		expect(getHorizontalPanEdge(0, bounds)).toBe(null);
	});
});
