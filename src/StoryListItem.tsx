import { Image } from 'expo-image';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Platform,
  SafeAreaView as SafeAreaViewNative,
  StyleSheet,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import GestureRecognizer from 'react-native-swipe-gestures';
import Video from 'react-native-video';
import { convert } from 'react-native-video-cache-turbo';
import { getStoryMediaType, isNullOrWhitespace, usePrevious } from './helpers';
import {
  IUserStoryItem,
  NextOrPrevious,
  StoryListItemProps,
} from './interfaces';

const { width, height } = Dimensions.get('window');

const SWIPE_CONFIG = {
  velocityThreshold: 0.3,
  directionalOffsetThreshold: 80,
};
const VIDEO_PROGRESS_UPDATE_INTERVAL_MS = 33;
const VIDEO_PROGRESS_SYNC_THRESHOLD = 0.04;

// Separate progress bar item to isolate re-renders
interface ProgressBarItemProps {
  isCurrent: boolean;
  finish: number;
  progress: SharedValue<number>;
  loadedAnimationBarStyle?: object;
  unloadedAnimationBarStyle?: object;
  storyId: string | number;
}

const ProgressBarItem = React.memo(
  ({
    isCurrent,
    finish,
    progress,
    loadedAnimationBarStyle,
    unloadedAnimationBarStyle,
    storyId,
  }: ProgressBarItemProps) => {
    const animatedStyle = useAnimatedStyle(() => ({
      flex: isCurrent ? progress.value : finish,
      height: 2,
      backgroundColor: 'white',
    }));

    return (
      <View
        key={storyId}
        style={[styles.animationBackground, unloadedAnimationBarStyle]}
      >
        <Animated.View style={[animatedStyle, loadedAnimationBarStyle]} />
      </View>
    );
  }
);

ProgressBarItem.displayName = 'ProgressBarItem';

const SafeArea = Platform.OS === 'ios' ? SafeAreaViewNative : SafeAreaView;

export const StoryListItem = ({
  index,
  key,
  userId,
  profileImage,
  profileName,
  duration = 10000,
  onFinish,
  onClosePress,
  stories,
  currentPage,
  isModalOpen = true,
  onStorySeen,
  renderCloseComponent,
  renderSwipeUpComponent,
  renderTextComponent,
  loadedAnimationBarStyle,
  unloadedAnimationBarStyle,
  animationBarContainerStyle,
  storyUserContainerStyle,
  storyImageStyle,
  storyAvatarImageStyle,
  storyContainerStyle,
  ...props
}: StoryListItemProps) => {
  const [load, setLoad] = useState(true);
  const [pressed, setPressed] = useState(false);
  const [isInteractionPaused, setIsInteractionPaused] = useState(false);
  const [current, setCurrent] = useState(0);
  const [content, setContent] = useState<IUserStoryItem[]>(() =>
    stories.map((x) => ({ ...x, finish: 0 }))
  );

  // Reanimated shared value replaces Animated.Value
  const progress = useSharedValue(0);

  const videoDurationRef = useRef(1);
  const videoProgressRatioRef = useRef(0);
  const videoProgressAnimationStartedRef = useRef(false);
  const isInteractionPausedRef = useRef(false);
  const prevCurrentPage = usePrevious(currentPage);

  // --- Page change effect ---
  useEffect(() => {
    const isPrevious =
      typeof prevCurrentPage === 'number' && prevCurrentPage > currentPage;

    setCurrent(isPrevious ? content.length - 1 : 0);

    setContent((prev) =>
      prev.map((x, i) => ({
        ...x,
        finish: isPrevious ? (i === prev.length - 1 ? 0 : 1) : 0,
      }))
    );

    start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage]);

  // --- Same-image adjacent story guard ---
  const prevCurrent = usePrevious(current);
  useEffect(() => {
    if (isNullOrWhitespace(prevCurrent) || typeof prevCurrent !== 'number')
      return;

    const sameImageForward =
      current > prevCurrent &&
      content[current - 1]?.story_image === content[current]?.story_image;
    const sameImageBackward =
      current < prevCurrent &&
      content[current + 1]?.story_image === content[current]?.story_image;

    if (sameImageForward || sameImageBackward) {
      start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  // --- Back-navigation explicit start ---
  const prevCurrentRef = useRef(current);
  useEffect(() => {
    if (current < prevCurrentRef.current) {
      start();
    }
    prevCurrentRef.current = current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  // --- onStorySeen ---
  useEffect(() => {
    if (onStorySeen && currentPage === index) {
      onStorySeen({
        user_id: userId,
        user_image: profileImage,
        user_name: profileName,
        story: content[current],
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, index, current]);

  // --- Helpers ---
  const currentMediaType = getStoryMediaType(content[current]);
  const isVideo = currentMediaType === 'video' && Boolean(Video);

  function start() {
    setLoad(false);
    progress.value = 0;
    videoProgressRatioRef.current = 0;
    videoProgressAnimationStartedRef.current = false;
    if (getStoryMediaType(content[current]) !== 'video' || !Video) {
      startAnimation();
    }
  }

  function startAnimation() {
    progress.value = withTiming(
      1,
      {
        duration,
        easing: Easing.linear,
      },
      (finished) => {
        if (finished) {
          runOnJS(next)();
        }
      }
    );
  }

  function stopAnimation() {
    cancelAnimation(progress);
  }

  const startVideoProgressAnimation = useCallback(
    (fromRatio: number) => {
      const clampedRatio = Math.max(0, Math.min(fromRatio, 1));
      videoProgressRatioRef.current = clampedRatio;
      videoProgressAnimationStartedRef.current = true;

      cancelAnimation(progress);
      progress.value = clampedRatio;

      const remainingMs = Math.max(
        (1 - clampedRatio) * videoDurationRef.current * 1000,
        0
      );

      if (remainingMs <= 0) return;

      progress.value = withTiming(1, {
        duration: remainingMs,
        easing: Easing.linear,
      });
    },
    [progress]
  );

  // Video progress handler — drives progress bar for video stories
  const onProgress = useCallback(
    (e: { currentTime: number }) => {
      if (isInteractionPausedRef.current) {
        cancelAnimation(progress);
        return;
      }

      const dur = videoDurationRef.current;
      if (dur <= 0) return;

      const ratio = Math.min(e.currentTime / dur, 1);
      videoProgressRatioRef.current = ratio;

      if (!videoProgressAnimationStartedRef.current) {
        startVideoProgressAnimation(ratio);
        return;
      }

      const drift = Math.abs(progress.value - ratio);
      if (drift > VIDEO_PROGRESS_SYNC_THRESHOLD) {
        startVideoProgressAnimation(ratio);
      }
    },
    [progress, startVideoProgressAnimation]
  );

  function next() {
    setLoad(true);
    if (current !== content.length - 1) {
      setContent((prev) => {
        const data = [...prev];
        data[current].finish = 1;
        return data;
      });
      setCurrent((c) => c + 1);
      progress.value = 0;
    } else {
      close('next');
    }
  }

  function previous() {
    setLoad(true);
    if (current - 1 >= 0) {
      setContent((prev) => {
        const data = [...prev];
        data[current].finish = 0;
        return data;
      });
      setCurrent((c) => c - 1);
      progress.value = 0;
    } else {
      close('previous');
    }
  }

  function close(state: NextOrPrevious) {
    setContent((prev) => prev.map((x) => ({ ...x, finish: 0 })));
    progress.value = 0;
    if (currentPage === index) {
      onFinish?.(state);
    }
  }

  const onSwipeUp = useCallback(() => {
    onClosePress?.();
    content[current].onPress?.();
  }, [onClosePress, content, current]);

  const onSwipeDown = useCallback(() => {
    onClosePress();
  }, [onClosePress]);

  const handlePressIn = useCallback(() => {
    isInteractionPausedRef.current = true;
    setIsInteractionPaused(true);
    stopAnimation();
  }, []);

  const handleLongPress = useCallback(() => setPressed(true), []);

  const handlePressOut = useCallback(() => {
    isInteractionPausedRef.current = false;
    setIsInteractionPaused(false);
    setPressed(false);
    if (isVideo) {
      startVideoProgressAnimation(videoProgressRatioRef.current);
    } else {
      startAnimation();
    }
  }, [isVideo, startVideoProgressAnimation]);

  const swipeText =
    content?.[current]?.swipeText || props.swipeText || 'Swipe Up';
  const isActiveCubePage = currentPage === index;
  const shouldRenderVideo =
    isModalOpen && isActiveCubePage && isVideo && content[current].story_video;

  return (
    <GestureRecognizer
      key={key}
      onSwipeUp={onSwipeUp}
      onSwipeDown={onSwipeDown}
      config={SWIPE_CONFIG}
      style={[styles.container, storyContainerStyle]}
    >
      <SafeArea style={styles.safeArea}>
        {/* Background media */}
        <View style={styles.backgroundContainer}>
          {shouldRenderVideo && content[current].story_video ? (
            <View style={styles.videoWrapper}>
              <Video
                key={content[current].story_id}
                source={{ uri: convert(content[current].story_video) }}
                resizeMode="cover"
                poster={
                  content[current].story_image
                    ? { uri: content[current].story_image }
                    : undefined
                }
                posterResizeMode="cover"
                style={StyleSheet.absoluteFillObject}
                onLoad={(e: { duration: number }) => {
                  videoDurationRef.current = e?.duration ?? 1;
                  start();
                }}
                onProgress={onProgress}
                progressUpdateInterval={VIDEO_PROGRESS_UPDATE_INTERVAL_MS}
                onEnd={next}
                onError={start}
                paused={isInteractionPaused}
                repeat={false}
                controls={false}
                showNotificationControls={false}
                hideShutterView
                {...(Platform.OS === 'android' && { useTextureView: true })}
              />
            </View>
          ) : isVideo &&
            content[current].story_video &&
            content[current].story_image ? (
            <Image
              key={content[current].story_id}
              source={{ uri: content[current].story_image }}
              style={[styles.image, storyImageStyle]}
              contentFit="cover"
            />
          ) : content[current].story_image ? (
            <Image
              key={content[current].story_id}
              onLoadEnd={start}
              source={{ uri: content[current].story_image }}
              style={[styles.image, storyImageStyle]}
            />
          ) : (
            <View
              key={content[current].story_id}
              style={[styles.image, styles.blackBackground]}
              onLayout={start}
            />
          )}

          {load && (
            <View style={styles.spinnerContainer}>
              <ActivityIndicator size="large" color="white" />
            </View>
          )}
        </View>

        {/* Overlay UI */}
        <View style={styles.flexCol}>
          {/* Progress bars */}
          <View
            style={[styles.animationBarContainer, animationBarContainerStyle]}
          >
            {content.map((storyItem, idx) => (
              <ProgressBarItem
                key={storyItem.story_id}
                storyId={storyItem.story_id}
                isCurrent={current === idx}
                finish={storyItem.finish || 0}
                progress={progress}
                loadedAnimationBarStyle={loadedAnimationBarStyle}
                unloadedAnimationBarStyle={unloadedAnimationBarStyle}
              />
            ))}
          </View>

          {/* User header */}
          <View style={[styles.userContainer, storyUserContainerStyle]}>
            <View style={styles.flexRowCenter}>
              <Image
                style={[styles.avatarImage, storyAvatarImageStyle]}
                source={{ uri: profileImage }}
              />
              {typeof renderTextComponent === 'function' ? (
                renderTextComponent({ item: content[current], profileName })
              ) : (
                <Text style={styles.avatarText}>{profileName}</Text>
              )}
            </View>
            <View style={styles.closeIconContainer}>
              {typeof renderCloseComponent === 'function' ? (
                renderCloseComponent({
                  onPress: onClosePress,
                  item: content[current],
                })
              ) : (
                <TouchableOpacity hitSlop={300} onPress={onClosePress}>
                  <Text style={styles.whiteText}>×</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Touch zones: previous / next */}
          <View style={styles.pressContainer}>
            <TouchableWithoutFeedback
              onPressIn={handlePressIn}
              onLongPress={handleLongPress}
              onPressOut={handlePressOut}
              onPress={() => {
                if (!pressed && !load) previous();
              }}
            >
              <View style={styles.flex} />
            </TouchableWithoutFeedback>
            <TouchableWithoutFeedback
              onPressIn={handlePressIn}
              onLongPress={handleLongPress}
              onPressOut={handlePressOut}
              onPress={() => {
                if (!pressed && !load) next();
              }}
            >
              <View style={styles.flex} />
            </TouchableWithoutFeedback>
          </View>
        </View>
      </SafeArea>

      {/* Swipe-up area */}
      {typeof renderSwipeUpComponent === 'function' ? (
        renderSwipeUpComponent({ onPress: onSwipeUp, item: content[current] })
      ) : (
        <TouchableOpacity
          activeOpacity={1}
          onPress={onSwipeUp}
          style={styles.swipeUpBtn}
        >
          <Text style={styles.swipeText}></Text>
          <Text style={styles.swipeText}>{swipeText}</Text>
        </TouchableOpacity>
      )}
    </GestureRecognizer>
  );
};

export default StoryListItem;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  flex: {
    flex: 1,
  },
  flexCol: {
    flex: 1,
    flexDirection: 'column',
  },
  flexRowCenter: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  image: {
    width: width,
    height: height,
    resizeMode: 'cover',
  },
  safeArea: {
    flex: 1,
  },
  videoWrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width,
    height,
  },
  backgroundContainer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
  },
  spinnerContainer: {
    zIndex: -100,
    position: 'absolute',
    justifyContent: 'center',
    backgroundColor: 'black',
    alignSelf: 'center',
    width: width,
    height: height,
  },
  animationBarContainer: {
    flexDirection: 'row',
    paddingTop: 10,
    paddingHorizontal: 10,
  },
  animationBackground: {
    height: 2,
    flex: 1,
    flexDirection: 'row',
    backgroundColor: 'rgba(117, 117, 117, 0.5)',
    marginHorizontal: 2,
  },
  userContainer: {
    height: 50,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 15,
  },
  avatarImage: {
    height: 30,
    width: 30,
    borderRadius: 100,
  },
  avatarText: {
    fontWeight: 'bold',
    color: 'white',
    paddingLeft: 10,
  },
  closeIconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 50,
    paddingHorizontal: 15,
  },
  pressContainer: {
    flex: 1,
    flexDirection: 'row',
  },
  swipeUpBtn: {
    position: 'absolute',
    right: 0,
    left: 0,
    alignItems: 'center',
    bottom: Platform.OS == 'ios' ? 20 : 50,
  },
  whiteText: {
    color: 'white',
    fontSize: 35,
  },
  swipeText: {
    color: 'white',
    marginTop: 5,
  },
});
