import React, {
    forwardRef,
    useCallback,
    useEffect,
    useImperativeHandle,
    useRef,
    useState
} from 'react';
import {
    Dimensions,
    GestureResponderEvent,
    PanResponder,
    PanResponderGestureState,
    Platform,
    StyleSheet,
} from 'react-native';
import Animated, {
    Extrapolation,
    interpolate,
    runOnJS,
    SharedValue,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
} from 'react-native-reanimated';

const { width, height } = Dimensions.get('window');

const getPERSPECTIVE = () => (Platform.OS === 'ios' ? 2.38 : 2.2);
const getTR_POSITION = () => (Platform.OS === 'ios' ? 2 : 1.4);
const getDefaultResponderCaptureDx = () =>
  Platform.OS === 'android' ? 20 : 60;

export interface CubeNavigationHorizontalProps {
  children: React.ReactNode[];
  callBackAfterSwipe?: (page: number | string) => void;
  callbackOnSwipe?: (isSwiping: boolean) => void;
  scrollLockPage?: number;
  responderCaptureDx?: number;
  expandView?: boolean;
  loop?: boolean;
}

export interface CubeNavigationHorizontalRef {
  scrollTo: (page: number, animated?: boolean) => void;
}

const closest = (num: number, pages: number[]): number => {
  let minDiff = 1000;
  let ans = 0;
  for (let i = 0; i < pages.length; i++) {
    const m = Math.abs(num - pages[i]);
    if (m < minDiff) {
      minDiff = m;
      ans = i;
    }
  }
  return ans;
};

const SPRING_CONFIG = {
  damping: 20,
  stiffness: 90,
  mass: 1,
};

const CubeNavigationHorizontal = forwardRef<
  CubeNavigationHorizontalRef,
  CubeNavigationHorizontalProps
>(function CubeNavigationHorizontal(
  {
    children,
    callBackAfterSwipe,
    callbackOnSwipe,
    scrollLockPage,
    responderCaptureDx: responderCaptureDxProp,
    expandView,
    loop,
  },
  ref
) {
  const childrenArray = React.Children.toArray(children);
  const pages = childrenArray.map((_, index) => width * -index);
  const fullWidth = (childrenArray.length - 1) * width;

  const pagesRef = useRef(pages);
  const fullWidthRef = useRef(fullWidth);
  pagesRef.current = pages;
  fullWidthRef.current = fullWidth;

  // Shared values replace Animated.ValueXY
  const scrollX = useSharedValue(0);
  const offsetX = useSharedValue(0);

  const [currentPage, setCurrentPage] = useState(0);
  const [, setPanHandlersReady] = useState(false);

  const callBackAfterSwipeRef = useRef(callBackAfterSwipe);
  const callbackOnSwipeRef = useRef(callbackOnSwipe);
  callBackAfterSwipeRef.current = callBackAfterSwipe;
  callbackOnSwipeRef.current = callbackOnSwipe;

  const panResponderRef = useRef<ReturnType<typeof PanResponder.create> | null>(
    null
  );

  useEffect(() => {
    const responderCaptureDx =
      responderCaptureDxProp ?? getDefaultResponderCaptureDx();

    const onDoneSwiping = (gestureState: PanResponderGestureState) => {
      if (callbackOnSwipeRef.current) {
        callbackOnSwipeRef.current(false);
      }
      const mod = gestureState.dx > 0 ? 100 : -100;
      const currentPages = pagesRef.current;
      const nextPage = closest(scrollX.value + mod, currentPages);
      const goTo = currentPages[nextPage];

      // Flatten offset into the value
      scrollX.value = scrollX.value;
      offsetX.value = 0;

      scrollX.value = withSpring(goTo, SPRING_CONFIG);

      setTimeout(() => {
        runOnJS(setCurrentPage)(nextPage);
        if (callBackAfterSwipeRef.current) {
          callBackAfterSwipeRef.current(nextPage);
        }
      }, 500);
    };

    const panResponder = PanResponder.create({
      onMoveShouldSetPanResponderCapture: (
        _evt: GestureResponderEvent,
        gestureState: PanResponderGestureState
      ) => Math.abs(gestureState.dx) > responderCaptureDx,

      onPanResponderGrant: () => {
        if (callbackOnSwipeRef.current) {
          callbackOnSwipeRef.current(true);
        }
        // Capture current animated position as offset base
        offsetX.value = scrollX.value;
      },

      onPanResponderMove: (
        _e: GestureResponderEvent,
        gestureState: PanResponderGestureState
      ) => {
        const currentFullWidth = fullWidthRef.current;

        if (loop) {
          if (gestureState.dx < 0 && scrollX.value < -currentFullWidth) {
            offsetX.value = offsetX.value + width;
          } else if (gestureState.dx > 0 && scrollX.value > 0) {
            offsetX.value = offsetX.value - (currentFullWidth + width);
          }
        }

        scrollX.value = offsetX.value + gestureState.dx;
      },

      onPanResponderRelease: (
        _e: GestureResponderEvent,
        gestureState: PanResponderGestureState
      ) => {
        onDoneSwiping(gestureState);
      },

      onPanResponderTerminate: (
        _e: GestureResponderEvent,
        gestureState: PanResponderGestureState
      ) => {
        onDoneSwiping(gestureState);
      },
    });

    panResponderRef.current = panResponder;
    setPanHandlersReady(true);
  }, [loop, responderCaptureDxProp, scrollX, offsetX]);

  useEffect(() => {
    if (scrollLockPage != null && scrollLockPage >= 0 && scrollLockPage < pages.length) {
      // scrollLockPage handling — stored for external reference if needed
    }
  }, [scrollLockPage, pages]);

  const scrollTo = useCallback(
    (page: number, animated: boolean = true) => {
      if (animated) {
        scrollX.value = withSpring(pages[page], SPRING_CONFIG);
      } else {
        scrollX.value = pages[page];
      }
      setCurrentPage(page);
    },
    [scrollX, pages]
  );

  useImperativeHandle(
    ref,
    () => ({
      scrollTo,
    }),
    [scrollTo]
  );

  const getTransformsFor = useCallback(
    (i: number) => {
      const pageX = -width * i;

      const loopVariable = (variable: number, sign: number = 1): number =>
        variable + Math.sign(sign) * (fullWidth + width);

      const padInput = (variables: number[]): number[] => {
        if (!loop) return variables;
        const returnedVariables = [...variables];
        returnedVariables.unshift(
          ...variables.map((variable) => loopVariable(variable, -1))
        );
        returnedVariables.push(
          ...variables.map((variable) => loopVariable(variable, 1))
        );
        return returnedVariables;
      };

      const padOutput = <T,>(variables: T[]): T[] => {
        if (!loop) return variables;
        const returnedVariables = [...variables];
        returnedVariables.unshift(...variables);
        returnedVariables.push(...variables);
        return returnedVariables;
      };

      const translateXInput = padInput([pageX - width, pageX, pageX + width]);
      const translateXOutput = padOutput([
        (-width - 1) / getTR_POSITION(),
        0,
        (width + 1) / getTR_POSITION(),
      ]);

      const rotateYInput = padInput([pageX - width, pageX, pageX + width]);
      const rotateYOutput = padOutput([-60, 0, 60]); // degrees as numbers

      const translateXAfterInput = padInput([
        pageX - width,
        pageX - width + 0.1,
        pageX,
        pageX + width - 0.1,
        pageX + width,
      ]);
      const translateXAfterOutput = padOutput([
        -width - 1,
        (-width - 1) / getPERSPECTIVE(),
        0,
        (width + 1) / getPERSPECTIVE(),
        width + 1,
      ]);

      const opacityInput = padInput([
        pageX - width,
        pageX - width + 10,
        pageX,
        pageX + width - 250,
        pageX + width,
      ]);
      const opacityOutput = padOutput([0, 0.6, 1, 0.6, 0]);

      return {
        translateXInput,
        translateXOutput,
        rotateYInput,
        rotateYOutput,
        translateXAfterInput,
        translateXAfterOutput,
        opacityInput,
        opacityOutput,
      };
    },
    [fullWidth, loop]
  );

  const renderChild = useCallback(
    (child: React.ReactElement, i: number) => {
      const expandStyle = expandView
        ? { paddingTop: 100, paddingBottom: 100, height: height + 200 }
        : { width, height };
      const childStyle = (child.props as { style?: unknown }).style;
      const style = [childStyle, expandStyle].filter(Boolean);
      const element = React.cloneElement(child, { i, style } as Record<string, unknown>);

      const transforms = getTransformsFor(i);

      return (
        <CubeChildView
          key={`child-${i}`}
          scrollX={scrollX}
          transforms={transforms}
          isActive={currentPage === i}
        >
          {element}
        </CubeChildView>
      );
    },
    [expandView, getTransformsFor, currentPage, scrollX]
  );

  const expandStyle = expandView
    ? { top: -100, left: 0, width, height: height + 200 }
    : { width, height };

  const containerStyle =
    Platform.OS === 'android' ? styles.flex : styles.absolute;

  const panHandlers = panResponderRef.current?.panHandlers ?? {};

  return (
    // eslint-disable-next-line react/jsx-props-no-spreading -- PanResponder handlers
    <Animated.View style={containerStyle} {...panHandlers}>
      <Animated.View style={[styles.blackFullScreen, expandStyle]}>
        {childrenArray.map((child, i) =>
          renderChild(child as React.ReactElement, i)
        )}
      </Animated.View>
    </Animated.View>
  );
});

// Separate animated child component to use hooks per-item
interface CubeChildViewProps {
  children: React.ReactNode;
  scrollX: SharedValue<number>;
  transforms: {
    translateXInput: number[];
    translateXOutput: number[];
    rotateYInput: number[];
    rotateYOutput: number[];
    translateXAfterInput: number[];
    translateXAfterOutput: number[];
    opacityInput: number[];
    opacityOutput: number[];
  };
  isActive: boolean;
}

function CubeChildView({
  children,
  scrollX,
  transforms,
  isActive,
}: CubeChildViewProps) {
  const {
    translateXInput,
    translateXOutput,
    rotateYInput,
    rotateYOutput,
    translateXAfterInput,
    translateXAfterOutput,
    opacityInput,
    opacityOutput,
  } = transforms;

  const animatedStyle = useAnimatedStyle(() => {
    const tx = interpolate(
      scrollX.value,
      translateXInput,
      translateXOutput,
      Extrapolation.CLAMP
    );
    const ry = interpolate(
      scrollX.value,
      rotateYInput,
      rotateYOutput,
      Extrapolation.CLAMP
    );
    const txAfter = interpolate(
      scrollX.value,
      translateXAfterInput,
      translateXAfterOutput,
      Extrapolation.CLAMP
    );
    const op = interpolate(
      scrollX.value,
      opacityInput,
      opacityOutput,
      Extrapolation.CLAMP
    );

    return {
      opacity: op,
      transform: [
        { perspective: width },
        { translateX: tx },
        { rotateY: `${ry}deg` },
        { translateX: txAfter },
      ],
    };
  });

  return (
    <Animated.View
      style={[StyleSheet.absoluteFillObject, { backgroundColor: 'transparent' }, animatedStyle]}
      pointerEvents={isActive ? 'auto' : 'none'}
    >
      {children}
    </Animated.View>
  );
}

CubeNavigationHorizontal.displayName = 'CubeNavigationHorizontal';

const styles = StyleSheet.create({
  absolute: {
    position: 'absolute',
  },
  flex: {
    flex: 1,
  },
  blackFullScreen: {
    backgroundColor: '#000',
    position: 'absolute',
    width,
    height,
  },
});

export default CubeNavigationHorizontal;
