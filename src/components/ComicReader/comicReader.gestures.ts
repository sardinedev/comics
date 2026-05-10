import type {
	GesturePoint,
	HorizontalPanEdge,
	ImageMetrics,
	PanBounds,
	Rect,
	Size,
	SwipeDirection,
	TapZone,
	ZoomRegion,
	ZoomTransform,
} from "./comicReader.types";

export const TAP_MAX_DISTANCE_PX = 12;
export const DOUBLE_TAP_MAX_DELAY_MS = 280;
export const DOUBLE_TAP_MAX_DISTANCE_PX = 44;
export const SWIPE_MIN_DISTANCE_PX = 48;
export const SWIPE_MAX_VERTICAL_PX = 80;
export const DOUBLE_PAGE_MIN_ASPECT_RATIO = 1.2;
export const PAN_EDGE_TOLERANCE_PX = 2;

/**
 * Returns the straight-line distance between two gesture points.
 *
 * @param first - The starting gesture point.
 * @param second - The ending gesture point.
 * @returns The Euclidean distance between the points, in pixels.
 */
function distance(first: GesturePoint, second: GesturePoint): number {
	return Math.hypot(second.x - first.x, second.y - first.y);
}

/**
 * Clamps a number into a range and normalizes negative zero for stable output.
 *
 * @param value - The value to clamp.
 * @param min - The inclusive lower bound.
 * @param max - The inclusive upper bound.
 * @returns The clamped value.
 */
function clamp(value: number, min: number, max: number): number {
	const clamped = Math.min(max, Math.max(min, value));
	return Object.is(clamped, -0) ? 0 : clamped;
}

/**
 * Maps an x-position in the reader viewport to the left, center, or right tap zone.
 *
 * @param x - The horizontal pointer position relative to the viewport.
 * @param width - The total width of the gesture area.
 * @returns The tap zone that should handle the pointer position.
 */
export function getTapZone(x: number, width: number): TapZone {
	const third = width / 3;
	if (x < third) return "previous";
	if (x > third * 2) return "next";
	return "controls";
}

/**
 * Maps an x-position in the reader viewport to the left or right page half.
 *
 * @param x - The horizontal pointer position relative to the viewport.
 * @param width - The total width of the gesture area.
 * @returns The page half that contains the pointer position.
 */
export function getPointZoomRegion(x: number, width: number): ZoomRegion {
	return x < width / 2 ? "left" : "right";
}

/**
 * Returns whether a pointer interaction stayed within the single-tap movement threshold.
 *
 * @param start - The pointer-down point.
 * @param end - The pointer-up point.
 * @returns Whether the interaction should be treated as a tap.
 */
export function isTapGesture(start: GesturePoint, end: GesturePoint): boolean {
	return distance(start, end) <= TAP_MAX_DISTANCE_PX;
}

/**
 * Returns whether two tap points are close enough in time and space to count as a double tap.
 *
 * @param previous - The previous tap point, or `null` if there is no pending tap.
 * @param next - The latest tap point.
 * @returns Whether the two taps should trigger a double-tap action.
 */
export function isDoubleTap(
	previous: GesturePoint | null,
	next: GesturePoint,
): boolean {
	if (!previous) return false;
	return (
		next.time - previous.time <= DOUBLE_TAP_MAX_DELAY_MS &&
		distance(previous, next) <= DOUBLE_TAP_MAX_DISTANCE_PX
	);
}

/**
 * Classifies a horizontal swipe as page navigation, ignoring short or mostly vertical gestures.
 *
 * @param start - The pointer-down point.
 * @param end - The pointer-up point.
 * @returns The page-navigation direction, or `null` when the gesture is not a swipe.
 */
export function classifySwipe(
	start: GesturePoint,
	end: GesturePoint,
): SwipeDirection | null {
	const deltaX = end.x - start.x;
	const deltaY = end.y - start.y;
	const absX = Math.abs(deltaX);
	const absY = Math.abs(deltaY);

	if (absX < SWIPE_MIN_DISTANCE_PX) return null;
	if (absY > SWIPE_MAX_VERTICAL_PX) return null;
	if (absX < absY * 1.25) return null;

	return deltaX < 0 ? "next" : "previous";
}

/**
 * Calculates the rendered image rectangle when an image is object-contained inside a container.
 *
 * @param container - The available reader viewport size.
 * @param natural - The image's natural pixel size.
 * @returns The image rectangle after object-contain scaling and centering.
 */
export function getContainedImageRect(container: Size, natural: Size): Rect {
	if (
		container.width <= 0 ||
		container.height <= 0 ||
		natural.width <= 0 ||
		natural.height <= 0
	) {
		return { x: 0, y: 0, width: 0, height: 0 };
	}

	const scale = Math.min(
		container.width / natural.width,
		container.height / natural.height,
	);
	const width = natural.width * scale;
	const height = natural.height * scale;

	return {
		x: (container.width - width) / 2,
		y: (container.height - height) / 2,
		width,
		height,
	};
}

/**
 * Returns whether the natural image aspect ratio looks like a double-page spread.
 *
 * @param natural - The image's natural pixel size.
 * @returns Whether the image is wide enough to receive half-page zoom behavior.
 */
export function isDoublePageSpread(natural: Size): boolean {
	if (natural.height <= 0) return false;
	return natural.width / natural.height >= DOUBLE_PAGE_MIN_ASPECT_RATIO;
}

/**
 * Calculates the min/max translation allowed for a zoomed page at the given scale.
 *
 * @param metrics - The reader viewport and natural image dimensions.
 * @param scale - The current zoom scale.
 * @returns The translation bounds that keep the zoomed image covering the viewport.
 */
export function getZoomBounds(metrics: ImageMetrics, scale: number): PanBounds {
	const fit = getContainedImageRect(metrics.container, metrics.natural);
	const maxX = Math.max(0, (fit.width * scale - metrics.container.width) / 2);
	const maxY = Math.max(0, (fit.height * scale - metrics.container.height) / 2);

	return {
		minX: -maxX,
		maxX,
		minY: -maxY,
		maxY,
	};
}

/**
 * Clamps a proposed zoom translation so panning cannot move beyond visible image bounds.
 *
 * @param translateX - The proposed horizontal translation.
 * @param translateY - The proposed vertical translation.
 * @param bounds - The allowed translation range.
 * @returns The clamped translation values.
 */
export function clampZoomTranslation(
	translateX: number,
	translateY: number,
	bounds: PanBounds,
): { translateX: number; translateY: number } {
	return {
		translateX: clamp(translateX, bounds.minX, bounds.maxX),
		translateY: clamp(translateY, bounds.minY, bounds.maxY),
	};
}

/**
 * Calculates the zoom transform that fits the requested half of a double-page spread.
 *
 * @param metrics - The reader viewport and natural image dimensions.
 * @param region - The page half to bring into focus.
 * @returns The zoom scale and translation for the selected half-page region.
 */
export function getHalfPageZoomTarget(
	metrics: ImageMetrics,
	region: ZoomRegion,
): ZoomTransform {
	const fit = getContainedImageRect(metrics.container, metrics.natural);
	const halfWidth = fit.width / 2;
	const scale = Math.max(
		1,
		Math.min(
			metrics.container.width / halfWidth,
			metrics.container.height / fit.height,
		),
	);
	const bounds = getZoomBounds(metrics, scale);
	const preferredTranslateX =
		region === "left" ? (fit.width * scale) / 4 : -(fit.width * scale) / 4;
	const translation = clampZoomTranslation(preferredTranslateX, 0, bounds);

	return {
		region,
		scale,
		translateX: translation.translateX,
		translateY: translation.translateY,
	};
}

/**
 * Returns the horizontal pan edge currently reached, if any, for edge-based page turns.
 *
 * @param translateX - The current horizontal translation.
 * @param bounds - The allowed translation range.
 * @param tolerance - The distance from an edge that still counts as reaching it.
 * @returns The reached horizontal edge, or `null` when the image is not at an edge.
 */
export function getHorizontalPanEdge(
	translateX: number,
	bounds: PanBounds,
	tolerance = PAN_EDGE_TOLERANCE_PX,
): HorizontalPanEdge {
	if (bounds.maxX === 0 && bounds.minX === 0) return null;
	if (translateX >= bounds.maxX - tolerance) return "left";
	if (translateX <= bounds.minX + tolerance) return "right";
	return null;
}
