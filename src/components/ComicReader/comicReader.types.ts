import type { ComicCacheMetadataInput } from "@components/ComicCache/comicCache.utils";

export type GesturePoint = {
	x: number;
	y: number;
	time: number;
};

export type TapZone = "previous" | "controls" | "next";
export type SwipeDirection = "previous" | "next";
export type ZoomRegion = "left" | "right";
export type HorizontalPanEdge = "left" | "right" | null;

export type Size = {
	width: number;
	height: number;
};

export type Rect = Size & {
	x: number;
	y: number;
};

export type ImageMetrics = {
	container: Size;
	natural: Size;
};

export type ZoomTransform = {
	region: ZoomRegion;
	scale: number;
	translateX: number;
	translateY: number;
};

export type PanBounds = {
	minX: number;
	maxX: number;
	minY: number;
	maxY: number;
};

export type NextIssueSummary = {
	id: string;
	seriesName: string;
	issueNumber: number | string;
	issueName?: string;
};

export type ComicReaderProps = {
	issueId: string;
	initialPage: number;
	initialProgressUpdatedAt?: string;
	nextIssue?: NextIssueSummary;
	/** True when canonical adjacency exists but that exact issue is not saved. */
	hasUndownloadedNextIssue?: boolean;
	/** Uses saved-library recovery links for fallback-shell errors. */
	offlineMode?: boolean;
	cacheMetadata?: ComicCacheMetadataInput;
};

export type ReaderZoomState = {
	region: ZoomRegion | null;
	scale: number;
	translateX: number;
	translateY: number;
};

export type ActiveGesture = {
	pointerId: number;
	start: GesturePoint;
	zoomStart: ReaderZoomState;
	edgeAtStart: HorizontalPanEdge;
};
