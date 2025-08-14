/**
 * VirtualizedTraceTimelineView - A performance-optimized version of TraceTimelineView
 *
 * This component uses TanStack Virtual to render only visible timeline items,
 * improving performance for traces with many observations in timeline view.
 *
 * Key features:
 * - Virtual scrolling for timeline items
 * - Maintains timeline visualization and interaction
 * - Supports all timeline features (time scales, metrics, etc.)
 * - Automatically used for traces with > 500 observations
 */

import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef, useMemo, useCallback, memo } from "react";
import { type NestedObservation } from "@/src/utils/types";
import {
  isPresent,
  type APIScoreV2,
  type TraceDomain,
  ObservationLevel,
  type ObservationLevelType,
} from "@langfuse/shared";
import { type ObservationReturnTypeWithMetadata } from "@/src/server/api/routers/traces";
import {
  calculateDisplayTotalCost,
  nestObservations,
  heatMapTextColor,
  unnestObservation,
} from "@/src/components/trace/lib/helpers";
import { cn } from "@/src/utils/tailwind";
import { InfoIcon } from "lucide-react";
import { api } from "@/src/utils/api";
import { useIsAuthenticatedAndProjectMember } from "@/src/features/auth/hooks";
import { ItemBadge } from "@/src/components/ItemBadge";
import { CommentCountIcon } from "@/src/features/comments/CommentCountIcon";
import { GroupedScoreBadges } from "@/src/components/grouped-score-badge";
import { formatIntervalSeconds } from "@/src/utils/dates";
import { usdFormatter } from "@/src/utils/numbers";

// Fixed widths for styling for v1
const SCALE_WIDTH = 900;
const STEP_SIZE = 100;

const PREDEFINED_STEP_SIZES = [
  0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20, 25,
  30, 35, 40, 45, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500,
];

const calculateStepSize = (latency: number, scaleWidth: number) => {
  const calculatedStepSize = latency / (scaleWidth / STEP_SIZE);
  return (
    PREDEFINED_STEP_SIZES.find((step) => step >= calculatedStepSize) ||
    PREDEFINED_STEP_SIZES[PREDEFINED_STEP_SIZES.length - 1]
  );
};

interface FlattenedTimelineItem {
  id: string;
  type: "trace" | "observation";
  observation?: NestedObservation;
  trace?: Omit<TraceDomain, "input" | "output" | "metadata"> & {
    latency?: number;
    input: string | null;
    output: string | null;
    metadata: string | null;
  };
  level: number;
  traceStartTime: Date;
  totalScaleSpan: number;
  isVisible: boolean;
}

const flattenTimelineObservations = (
  observations: NestedObservation[],
  expandedItems: string[],
  traceStartTime: Date,
  totalScaleSpan: number,
  level = 1,
): FlattenedTimelineItem[] => {
  const flattened: FlattenedTimelineItem[] = [];

  observations.forEach((observation) => {
    const itemId = `observation-${observation.id}`;
    const isExpanded = expandedItems.includes(itemId);

    flattened.push({
      id: observation.id,
      type: "observation",
      observation,
      level,
      traceStartTime,
      totalScaleSpan,
      isVisible: true,
    });

    // Add children if expanded
    if (isExpanded && observation.children.length > 0) {
      const childrenFlattened = flattenTimelineObservations(
        observation.children,
        expandedItems,
        traceStartTime,
        totalScaleSpan,
        level + 1,
      );
      flattened.push(...childrenFlattened);
    }
  });

  return flattened;
};

export const VirtualizedTraceTimelineView = memo(
  ({
    trace,
    observations,
    projectId,
    scores,
    currentObservationId,
    setCurrentObservationId,
    expandedItems,
    setExpandedItems: _setExpandedItems,
    showMetrics = true,
    showScores = true,
    showComments = true,
    colorCodeMetrics = true,
    minLevel,
    setMinLevel,
  }: {
    trace: Omit<TraceDomain, "input" | "output" | "metadata"> & {
      latency?: number;
      input: string | null;
      output: string | null;
      metadata: string | null;
    };
    observations: Array<ObservationReturnTypeWithMetadata>;
    projectId: string;
    scores: APIScoreV2[];
    currentObservationId: string | null;
    setCurrentObservationId: (id: string | null) => void;
    expandedItems: string[];
    setExpandedItems: (items: string[]) => void;
    showMetrics?: boolean;
    showScores?: boolean;
    showComments?: boolean;
    colorCodeMetrics?: boolean;
    minLevel?: ObservationLevelType;
    setMinLevel?: React.Dispatch<React.SetStateAction<ObservationLevelType>>;
  }) => {
    const { latency, name, id } = trace;
    const parentRef = useRef<HTMLDivElement>(null);

    // Memoize the setCurrentObservationId to prevent unnecessary re-renders
    const memoizedSetCurrentObservationId = useCallback(
      (id: string | null) => {
        setCurrentObservationId(id);
      },
      [setCurrentObservationId],
    );

    const { nestedObservations, hiddenObservationsCount } = useMemo(
      () => nestObservations(observations, minLevel),
      [observations, minLevel],
    );

    // Calculate total cost for all observations
    const totalCost = useMemo(
      () =>
        calculateDisplayTotalCost({
          allObservations: observations,
        }),
      [observations],
    );

    const isAuthenticatedAndProjectMember =
      useIsAuthenticatedAndProjectMember(projectId);

    const observationCommentCounts = api.comments.getCountByObjectType.useQuery(
      {
        projectId: trace.projectId,
        objectType: "OBSERVATION",
      },
      {
        trpc: { context: { skipBatch: true } },
        refetchOnMount: false,
        enabled: isAuthenticatedAndProjectMember && showComments,
      },
    );

    const traceCommentCounts = api.comments.getCountByObjectId.useQuery(
      {
        projectId: trace.projectId,
        objectId: trace.id,
        objectType: "TRACE",
      },
      {
        trpc: { context: { skipBatch: true } },
        refetchOnMount: false,
        enabled: isAuthenticatedAndProjectMember && showComments,
      },
    );

    const stepSize = latency ? calculateStepSize(latency, SCALE_WIDTH) : 1;
    const totalScaleSpan = stepSize * (SCALE_WIDTH / STEP_SIZE);
    const traceScores = scores.filter((s) => s.observationId === null);
    const totalDuration = latency ? latency * 1000 : 1000;

    // Flatten the timeline items for virtualization
    const flattenedItems = useMemo(() => {
      const items: FlattenedTimelineItem[] = [];

      // Add trace node
      items.push({
        id: trace.id,
        type: "trace",
        trace,
        level: 0,
        traceStartTime: nestedObservations[0]?.startTime || new Date(),
        totalScaleSpan,
        isVisible: true,
      });

      // Add flattened observations
      if (nestedObservations.length > 0) {
        const flattenedObs = flattenTimelineObservations(
          nestedObservations,
          expandedItems,
          nestedObservations[0].startTime,
          totalScaleSpan,
        );
        items.push(...flattenedObs);
      }

      return items;
    }, [nestedObservations, expandedItems, trace, totalScaleSpan]);

    const virtualizer = useVirtualizer({
      count: flattenedItems.length,
      getScrollElement: () => parentRef.current,
      estimateSize: useCallback(() => 50, []),
      overscan: 10,
    });

    const renderTimelineItem = useCallback(
      (item: FlattenedTimelineItem) => {
        if (item.type === "trace" && item.trace) {
          const itemWidth = ((latency || 1) / totalScaleSpan) * SCALE_WIDTH;

          return (
            <div className="group my-0.5 flex w-full min-w-fit flex-row items-center">
              <div
                className="flex items-center"
                style={{ width: `${SCALE_WIDTH}px` }}
              >
                <div
                  className="relative flex flex-row"
                  style={{ width: `${SCALE_WIDTH}px` }}
                >
                  <div
                    className={cn(
                      "flex h-8 items-center justify-start rounded-sm border border-border bg-muted",
                      currentObservationId === null
                        ? "ring ring-primary-accent"
                        : "group-hover:ring group-hover:ring-tertiary",
                    )}
                    style={{ width: `${itemWidth || 10}px` }}
                    onClick={() => memoizedSetCurrentObservationId(null)}
                  >
                    <div className="ml-1 flex flex-row items-center justify-start gap-2 text-xs text-muted-foreground">
                      <ItemBadge type="TRACE" isSmall />
                      <span className="whitespace-nowrap text-sm font-medium text-primary">
                        {name}
                      </span>
                      {showComments && traceCommentCounts.data?.get(id) ? (
                        <CommentCountIcon
                          count={traceCommentCounts.data.get(id)}
                        />
                      ) : null}
                      {showMetrics && isPresent(latency) && (
                        <span className="text-xs text-muted-foreground">
                          {formatIntervalSeconds(latency)}
                        </span>
                      )}
                      {showMetrics && totalCost && (
                        <span className="text-xs text-muted-foreground">
                          {usdFormatter(totalCost.toNumber())}
                        </span>
                      )}
                      {showScores && traceScores && traceScores.length > 0 && (
                        <div className="flex max-h-8 gap-1">
                          <GroupedScoreBadges
                            scores={traceScores}
                            maxVisible={3}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        }

        if (item.type === "observation" && item.observation) {
          const observation = item.observation;
          const { startTime, endTime } = observation;

          const observationLatency = endTime
            ? (endTime.getTime() - startTime.getTime()) / 1000
            : undefined;

          const startOffset =
            ((startTime.getTime() - item.traceStartTime.getTime()) /
              totalScaleSpan /
              1000) *
            SCALE_WIDTH;

          const itemWidth = observationLatency
            ? (observationLatency / totalScaleSpan) * SCALE_WIDTH
            : undefined;

          const observationScores = scores.filter(
            (s) => s.observationId === observation.id,
          );
          const unnestedObservations = unnestObservation(observation);
          const observationTotalCost = calculateDisplayTotalCost({
            allObservations: unnestedObservations,
          });

          const isSelected = observation.id === currentObservationId;

          return (
            <div className="group my-0.5 flex w-full min-w-fit flex-row items-center">
              <div
                className="flex items-center"
                style={{ width: `${SCALE_WIDTH}px` }}
              >
                <div
                  className="relative flex flex-row"
                  style={{ width: `${SCALE_WIDTH}px` }}
                >
                  <div
                    className="relative"
                    style={{ marginLeft: `${startOffset}px` }}
                  >
                    <div
                      className={cn(
                        "flex h-8 items-center justify-start rounded-sm border border-border bg-muted",
                        itemWidth ? "" : "border-dashed",
                        isSelected
                          ? "ring ring-primary-accent"
                          : "group-hover:ring group-hover:ring-tertiary",
                      )}
                      style={{ width: `${itemWidth || 10}px` }}
                      onClick={() =>
                        memoizedSetCurrentObservationId(observation.id)
                      }
                    >
                      <div
                        className={cn(
                          "flex flex-row items-center justify-start gap-2 text-xs text-muted-foreground",
                          observation.children.length > 0 ? "ml-6" : "ml-1",
                        )}
                      >
                        <ItemBadge type={observation.type} isSmall />
                        <span className="whitespace-nowrap text-sm font-medium text-primary">
                          {observation.name}
                        </span>
                        {showComments &&
                        observationCommentCounts.data?.get(observation.id) ? (
                          <CommentCountIcon
                            count={observationCommentCounts.data.get(
                              observation.id,
                            )}
                          />
                        ) : null}
                        {showMetrics && isPresent(observationLatency) && (
                          <span
                            className={cn(
                              "text-xs text-muted-foreground",
                              totalDuration &&
                                colorCodeMetrics &&
                                heatMapTextColor({
                                  max: totalDuration,
                                  value: observationLatency * 1000,
                                }),
                            )}
                          >
                            {formatIntervalSeconds(observationLatency)}
                          </span>
                        )}
                        {showMetrics && observationTotalCost && (
                          <span
                            className={cn(
                              "text-xs text-muted-foreground",
                              totalCost &&
                                colorCodeMetrics &&
                                heatMapTextColor({
                                  max: totalCost,
                                  value: observationTotalCost,
                                }),
                            )}
                          >
                            {usdFormatter(observationTotalCost.toNumber())}
                          </span>
                        )}
                        {showScores &&
                          observationScores &&
                          observationScores.length > 0 && (
                            <div className="flex max-h-8 gap-1">
                              <GroupedScoreBadges
                                scores={observationScores}
                                maxVisible={3}
                              />
                            </div>
                          )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        }

        return null;
      },
      [
        latency,
        totalScaleSpan,
        currentObservationId,
        memoizedSetCurrentObservationId,
        name,
        id,
        showComments,
        traceCommentCounts.data,
        showMetrics,
        totalCost,
        showScores,
        traceScores,
        scores,
        observationCommentCounts.data,
        totalDuration,
        colorCodeMetrics,
      ],
    );

    if (!latency) return null;

    return (
      <div ref={parentRef} className="h-full w-full px-3">
        <div className="relative flex max-h-full flex-col">
          {/* Sticky time index section */}
          <div className="sticky top-0 z-20 bg-background">
            <div className="mb-2 ml-2">
              <div
                className="relative mr-2 h-8"
                style={{ width: `${SCALE_WIDTH}px` }}
              >
                {Array.from({
                  length: Math.ceil(SCALE_WIDTH / STEP_SIZE) + 1,
                }).map((_, index) => {
                  const step = stepSize * index;
                  return (
                    <div
                      key={index}
                      className="absolute h-full border border-l text-xs"
                      style={{ left: `${index * STEP_SIZE}px` }}
                    >
                      <span
                        className="absolute left-2 text-xs text-muted-foreground"
                        title={`${step.toFixed(2)}s`}
                      >
                        {step.toFixed(2)}s
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Virtualized content */}
          <div className="flex-1 overflow-auto" style={{ contain: "strict" }}>
            <div
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                width: "100%",
                position: "relative",
              }}
            >
              {virtualizer.getVirtualItems().map((virtualItem) => {
                const item = flattenedItems[virtualItem.index];
                return (
                  <div
                    key={virtualItem.key}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: `${virtualItem.size}px`,
                      transform: `translateY(${virtualItem.start}px)`,
                    }}
                  >
                    {renderTimelineItem(item)}
                  </div>
                );
              })}
            </div>
          </div>

          {minLevel && hiddenObservationsCount > 0 ? (
            <div className="flex items-center gap-1 p-2 py-4">
              <InfoIcon className="h-4 w-4 text-muted-foreground" />
              <span className="flex flex-row gap-1 text-sm text-muted-foreground">
                <p>
                  {hiddenObservationsCount} observations below {minLevel} level
                  are hidden.
                </p>
                {setMinLevel && (
                  <p
                    className="cursor-pointer underline"
                    onClick={() => setMinLevel(ObservationLevel.DEBUG)}
                  >
                    Show all
                  </p>
                )}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    );
  },
);

// Set display name for React DevTools
VirtualizedTraceTimelineView.displayName = "VirtualizedTraceTimelineView";
