/**
 * VirtualizedObservationTree - A performance-optimized version of ObservationTree
 *
 * This component uses TanStack Virtual to render only visible tree nodes,
 * dramatically improving performance when displaying traces with many observations.
 *
 * Key features:
 * - Only renders visible DOM nodes (virtual scrolling)
 * - Supports expand/collapse functionality
 * - Maintains all original features (metrics, scores, comments, etc.)
 * - Automatically used for traces with > 500 observations
 */

import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef, useMemo, useCallback, memo } from "react";
import { type NestedObservation } from "@/src/utils/types";
import {
  type APIScoreV2,
  ObservationLevel,
  type ObservationLevelType,
  type TraceDomain,
} from "@langfuse/shared";
import { type ObservationReturnType } from "@/src/server/api/routers/traces";
import {
  calculateDisplayTotalCost,
  nestObservations,
} from "@/src/components/trace/lib/helpers";
import { InfoIcon } from "lucide-react";
import {
  ObservationTreeTraceNode,
  ObservationTreeNodeCard,
} from "./ObservationTree";

interface FlattenedObservation {
  id: string;
  type: "trace" | "observation";
  observation?: NestedObservation;
  trace?: Omit<TraceDomain, "input" | "output" | "metadata"> & {
    latency?: number;
    input: string | null;
    output: string | null;
    metadata: string | null;
  };
  indentationLevel: number;
  isVisible: boolean;
}

const flattenObservations = (
  observations: NestedObservation[],
  collapsedObservations: string[],
  indentationLevel = 1,
): FlattenedObservation[] => {
  const flattened: FlattenedObservation[] = [];

  observations.forEach((observation) => {
    const isCollapsed = collapsedObservations.includes(observation.id);

    flattened.push({
      id: observation.id,
      type: "observation",
      observation,
      indentationLevel,
      isVisible: true,
    });

    // Add children if not collapsed
    if (!isCollapsed && observation.children.length > 0) {
      const childrenFlattened = flattenObservations(
        observation.children,
        collapsedObservations,
        indentationLevel + 1,
      );
      flattened.push(...childrenFlattened);
    }
  });

  return flattened;
};

export const VirtualizedObservationTree = memo(
  ({
    showExpandControls = true,
    showComments,
    ...props
  }: {
    observations: ObservationReturnType[];
    collapsedObservations: string[];
    toggleCollapsedObservation: (id: string) => void;
    collapseAll: () => void;
    expandAll: () => void;
    trace: Omit<TraceDomain, "input" | "output" | "metadata"> & {
      latency?: number;
      input: string | null;
      output: string | null;
      metadata: string | null;
    };
    scores: APIScoreV2[];
    currentObservationId: string | undefined;
    setCurrentObservationId: (id: string | undefined) => void;
    showMetrics: boolean;
    showScores: boolean;
    colorCodeMetrics: boolean;
    observationCommentCounts?: Map<string, number>;
    traceCommentCounts?: Map<string, number>;
    className?: string;
    showExpandControls?: boolean;
    minLevel?: ObservationLevelType;
    setMinLevel?: React.Dispatch<React.SetStateAction<ObservationLevelType>>;
    showComments: boolean;
  }) => {
    const parentRef = useRef<HTMLDivElement>(null);

    // Destructure props to avoid dependency issues
    const { setCurrentObservationId } = props;

    // Memoize the setCurrentObservationId to prevent unnecessary re-renders
    const memoizedSetCurrentObservationId = useCallback(
      (id: string | undefined) => {
        setCurrentObservationId(id);
      },
      [setCurrentObservationId],
    );

    const { nestedObservations, hiddenObservationsCount } = useMemo(
      () => nestObservations(props.observations, props.minLevel),
      [props.observations, props.minLevel],
    );

    const totalCost = useMemo(() => {
      return calculateDisplayTotalCost({
        allObservations: props.observations,
      });
    }, [props.observations]);

    // Flatten the nested observations for virtualization
    const flattenedItems = useMemo(() => {
      const items: FlattenedObservation[] = [];

      // Add trace node
      items.push({
        id: props.trace.id,
        type: "trace",
        trace: props.trace,
        indentationLevel: 0,
        isVisible: true,
      });

      // Add flattened observations
      const flattenedObs = flattenObservations(
        nestedObservations,
        props.collapsedObservations,
      );
      items.push(...flattenedObs);

      return items;
    }, [nestedObservations, props.collapsedObservations, props.trace]);

    const virtualizer = useVirtualizer({
      count: flattenedItems.length,
      getScrollElement: () => parentRef.current,
      estimateSize: useCallback(() => 60, []), // Estimated height per item
      overscan: 10, // Render 10 items outside viewport for smooth scrolling
    });

    const renderItem = useCallback(
      (item: FlattenedObservation) => {
        if (item.type === "trace" && item.trace) {
          return (
            <ObservationTreeTraceNode
              expandAll={props.expandAll}
              collapseAll={props.collapseAll}
              trace={item.trace}
              scores={props.scores}
              comments={props.traceCommentCounts}
              currentObservationId={props.currentObservationId}
              setCurrentObservationId={memoizedSetCurrentObservationId}
              showMetrics={props.showMetrics}
              showScores={props.showScores}
              totalCost={totalCost}
              showExpandControls={showExpandControls}
              showComments={showComments}
            />
          );
        }

        if (item.type === "observation" && item.observation) {
          const observation = item.observation;
          const collapsed = props.collapsedObservations.includes(
            observation.id,
          );

          return (
            <ObservationTreeNodeCard
              observation={observation}
              collapsed={collapsed}
              toggleCollapsedObservation={props.toggleCollapsedObservation}
              scores={props.scores}
              comments={props.observationCommentCounts}
              indentationLevel={item.indentationLevel}
              currentObservationId={props.currentObservationId}
              setCurrentObservationId={memoizedSetCurrentObservationId}
              showMetrics={props.showMetrics}
              showScores={props.showScores}
              colorCodeMetrics={props.colorCodeMetrics}
              parentTotalCost={totalCost}
              parentTotalDuration={
                props.trace.latency ? props.trace.latency * 1000 : undefined
              }
              showComments={showComments}
            />
          );
        }

        return null;
      },
      [
        memoizedSetCurrentObservationId,
        totalCost,
        showExpandControls,
        showComments,
        props.expandAll,
        props.collapseAll,
        props.scores,
        props.traceCommentCounts,
        props.currentObservationId,
        props.showMetrics,
        props.showScores,
        props.collapsedObservations,
        props.toggleCollapsedObservation,
        props.observationCommentCounts,
        props.colorCodeMetrics,
        props.trace.latency,
      ],
    );

    console.log("Current Observation Id", props.currentObservationId);

    return (
      <div className={props.className}>
        <div
          ref={parentRef}
          className="h-full overflow-auto"
          style={{
            contain: "strict",
          }}
        >
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
                  {renderItem(item)}
                </div>
              );
            })}
          </div>
        </div>

        {props.minLevel && hiddenObservationsCount > 0 ? (
          <span className="flex items-center gap-1 p-2 py-4">
            <InfoIcon className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              <span>
                {hiddenObservationsCount}{" "}
                {hiddenObservationsCount === 1 ? "observation" : "observations"}{" "}
                below {props.minLevel} level are hidden.{" "}
              </span>
              <span
                className="cursor-pointer underline"
                onClick={() => props.setMinLevel?.(ObservationLevel.DEBUG)}
              >
                Show all
              </span>
            </p>
          </span>
        ) : null}
      </div>
    );
  },
);

// Set display name for React DevTools
VirtualizedObservationTree.displayName = "VirtualizedObservationTree";
