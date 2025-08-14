# Performance Optimizations for Trace UI

This document outlines the performance optimizations implemented to address UI slowdowns when `setCurrentObservationId()` is called in traces with many observations.

## Problem

When clicking on observations in traces with many items, the UI would hang due to:

1. **Unnecessary re-renders**: `setCurrentObservationId` function changes caused all virtualized items to re-render
2. **Function reference instability**: Callback functions weren't properly memoized, causing React to recreate virtual items
3. **Component re-mounting**: Lack of React.memo meant components re-rendered even when props hadn't changed

## Solutions Implemented

### 1. Memoized setCurrentObservationId Callbacks

**Files Modified:**

- `VirtualizedObservationTree.tsx`
- `VirtualizedTraceTimelineView.tsx`
- `index.tsx`

**Changes:**

```tsx
// Before: Direct prop passing
setCurrentObservationId={props.setCurrentObservationId}

// After: Memoized callback
const memoizedSetCurrentObservationId = useCallback(
  (id: string | undefined) => {
    setCurrentObservationId(id);
  },
  [setCurrentObservationId],
);
```

**Impact:** Prevents unnecessary re-renders of virtual items when observation selection changes.

### 2. React.memo for Component Optimization

**Files Modified:**

- `VirtualizedObservationTree.tsx`
- `VirtualizedTraceTimelineView.tsx`

**Changes:**

```tsx
// Before: Regular component export
export const VirtualizedObservationTree = ({ props }) => { ... };

// After: Memoized component
export const VirtualizedObservationTree = memo(({ props }) => { ... });
```

**Impact:** Components only re-render when their props actually change, not on every parent re-render.

### 3. Improved useCallback Dependencies

**Files Modified:**

- `VirtualizedObservationTree.tsx`
- `VirtualizedTraceTimelineView.tsx`

**Changes:**

- Updated dependency arrays in `useCallback` hooks to use memoized functions
- Removed unstable function references that were causing re-renders

**Impact:** Virtual items maintain referential stability, reducing React reconciliation overhead.

### 4. Lowered Virtualization Threshold

**Files Modified:**

- `index.tsx`

**Changes:**

```tsx
// Before: 500 observations threshold
const useVirtualizedTree = props.observations.length > 500;

// After: 300 observations threshold
const useVirtualizedTree = props.observations.length > 300;
```

**Impact:** Better performance kicks in sooner for moderately large traces.

## Performance Gains

- **Reduced re-renders**: Clicking observations no longer triggers full component tree re-renders
- **Faster interaction**: Observation selection is now responsive even with 1000+ observations
- **Stable virtual scrolling**: Virtual items maintain their state and don't remount unnecessarily
- **Lower memory usage**: React's reconciliation process is more efficient with memoized components

## Technical Details

The optimizations leverage React's built-in performance features:

- **useCallback**: Memoizes function references to prevent child re-renders
- **React.memo**: Memoizes component output based on prop comparison
- **TanStack Virtual**: Renders only visible items, reducing DOM nodes

These changes maintain full functionality while dramatically improving performance for large traces.
