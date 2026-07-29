#import <CoreGraphics/CoreGraphics.h>
#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>
#import <Vision/Vision.h>

static double RectArea(CGRect rect) {
  return MAX(0, rect.size.width) * MAX(0, rect.size.height);
}

static double CenterDistance(CGRect rect) {
  double dx = CGRectGetMidX(rect) - 0.5;
  double dy = CGRectGetMidY(rect) - 0.5;
  return MIN(1, sqrt(dx * dx + dy * dy) / sqrt(0.5));
}

static VNRectangleObservation *LargestRectangle(NSArray<VNRectangleObservation *> *items) {
  VNRectangleObservation *best = nil;
  for (VNRectangleObservation *item in items ?: @[]) {
    if (best == nil || RectArea(item.boundingBox) > RectArea(best.boundingBox)) best = item;
  }
  return best;
}

static NSDictionary *BaseOutput(NSDictionary *input) {
  return @{
    @"id": input[@"id"] ?: @"",
    @"url": input[@"url"] ?: @"",
    @"width": @0,
    @"height": @0,
    @"byteLength": input[@"byteLength"] ?: @0,
    @"mimeType": input[@"mimeType"] ?: @"application/octet-stream",
    @"decoded": @NO,
    @"isAnimated": @NO,
    @"isUtility": @NO,
    @"aestheticsScore": @(-1),
    @"textCoverage": @0,
    @"humanConfidence": @0,
    @"humanAreaRatio": @0,
    @"humanCenterDistance": @1,
    @"poseJointCount": @0,
    @"foregroundAreaRatio": @0,
    @"foregroundCenterDistance": @1,
  };
}

static NSDictionary *Failure(NSDictionary *input, NSString *message) {
  NSMutableDictionary *out = [BaseOutput(input) mutableCopy];
  out[@"error"] = message;
  return out;
}

static NSDictionary *Analyze(NSDictionary *input) {
  NSString *path = input[@"path"];
  if (![path isKindOfClass:NSString.class] || path.length == 0) {
    return Failure(input, @"invalid_path");
  }

  NSURL *fileURL = [NSURL fileURLWithPath:path];
  CGImageSourceRef source = CGImageSourceCreateWithURL((__bridge CFURLRef)fileURL, NULL);
  if (source == NULL) return Failure(input, @"image_source_unavailable");

  size_t frameCount = CGImageSourceGetCount(source);
  NSDictionary *properties = CFBridgingRelease(
    CGImageSourceCopyPropertiesAtIndex(source, 0, NULL)
  );
  size_t width = [properties[(id)kCGImagePropertyPixelWidth] unsignedIntegerValue];
  size_t height = [properties[(id)kCGImagePropertyPixelHeight] unsignedIntegerValue];
  NSDictionary *options = @{
    (id)kCGImageSourceShouldCache: @NO,
    (id)kCGImageSourceShouldAllowFloat: @YES,
  };
  CGImageRef image = CGImageSourceCreateImageAtIndex(
    source,
    0,
    (__bridge CFDictionaryRef)options
  );
  CFRelease(source);
  if (image == NULL || width == 0 || height == 0) {
    if (image != NULL) CGImageRelease(image);
    return Failure(input, @"image_decode_failed");
  }

  VNDetectHumanRectanglesRequest *humanRequest = [VNDetectHumanRectanglesRequest new];
  humanRequest.upperBodyOnly = NO;
  VNDetectHumanBodyPoseRequest *poseRequest = [VNDetectHumanBodyPoseRequest new];
  VNGenerateObjectnessBasedSaliencyImageRequest *foregroundRequest =
    [VNGenerateObjectnessBasedSaliencyImageRequest new];
  VNCalculateImageAestheticsScoresRequest *aestheticsRequest =
    [VNCalculateImageAestheticsScoresRequest new];
  VNRecognizeTextRequest *textRequest = [VNRecognizeTextRequest new];
  textRequest.recognitionLevel = VNRequestTextRecognitionLevelFast;
  textRequest.usesLanguageCorrection = NO;
  textRequest.minimumTextHeight = 0.025;

  VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithCGImage:image options:@{}];
  NSError *visionError = nil;
  BOOL performed = [handler performRequests:@[
    humanRequest,
    poseRequest,
    foregroundRequest,
    aestheticsRequest,
    textRequest,
  ] error:&visionError];
  CGImageRelease(image);

  NSMutableDictionary *out = [BaseOutput(input) mutableCopy];
  out[@"width"] = @(width);
  out[@"height"] = @(height);
  out[@"decoded"] = @YES;
  out[@"isAnimated"] = @(frameCount > 1);
  if (!performed) {
    out[@"error"] = [NSString stringWithFormat:@"vision_failed:%@", visionError.localizedDescription];
    return out;
  }

  NSArray<VNHumanObservation *> *humans = humanRequest.results ?: @[];
  NSArray<VNHumanBodyPoseObservation *> *poses = poseRequest.results ?: @[];
  VNHumanObservation *largestHuman = nil;
  float humanConfidence = 0;
  for (VNHumanObservation *human in humans) {
    if (largestHuman == nil || RectArea(human.boundingBox) > RectArea(largestHuman.boundingBox)) {
      largestHuman = human;
    }
    humanConfidence = MAX(humanConfidence, human.confidence);
  }

  NSInteger poseJointCount = 0;
  for (VNHumanBodyPoseObservation *pose in poses) {
    humanConfidence = MAX(humanConfidence, pose.confidence);
    NSError *pointError = nil;
    NSDictionary<VNHumanBodyPoseObservationJointName, VNRecognizedPoint *> *points =
      [pose recognizedPointsForJointsGroupName:VNHumanBodyPoseObservationJointsGroupNameAll
                                        error:&pointError];
    NSInteger count = 0;
    for (VNRecognizedPoint *point in points.allValues ?: @[]) {
      if (point.confidence >= 0.3) count += 1;
    }
    poseJointCount = MAX(poseJointCount, count);
  }

  VNSaliencyImageObservation *saliency = foregroundRequest.results.firstObject;
  VNRectangleObservation *foreground = LargestRectangle(saliency.salientObjects);
  VNImageAestheticsScoresObservation *aesthetics = aestheticsRequest.results.firstObject;
  double textCoverage = 0;
  for (VNRecognizedTextObservation *text in textRequest.results ?: @[]) {
    textCoverage += RectArea(text.boundingBox);
  }

  out[@"isUtility"] = @(aesthetics.isUtility);
  out[@"aestheticsScore"] = @(aesthetics ? aesthetics.overallScore : -1);
  out[@"textCoverage"] = @(MIN(1, textCoverage));
  out[@"humanConfidence"] = @(humanConfidence);
  out[@"humanAreaRatio"] = @(largestHuman ? RectArea(largestHuman.boundingBox) : 0);
  out[@"humanCenterDistance"] = @(largestHuman ? CenterDistance(largestHuman.boundingBox) : 1);
  out[@"poseJointCount"] = @(poseJointCount);
  out[@"foregroundAreaRatio"] = @(foreground ? RectArea(foreground.boundingBox) : 0);
  out[@"foregroundCenterDistance"] = @(foreground ? CenterDistance(foreground.boundingBox) : 1);
  out[@"error"] = [NSNull null];
  return out;
}

int main(void) {
  @autoreleasepool {
    char *buffer = NULL;
    size_t capacity = 0;
    while (getline(&buffer, &capacity, stdin) != -1) {
      @autoreleasepool {
        NSData *line = [NSData dataWithBytes:buffer length:strlen(buffer)];
        NSError *parseError = nil;
        NSDictionary *input = [NSJSONSerialization JSONObjectWithData:line options:0 error:&parseError];
        if (![input isKindOfClass:NSDictionary.class]) {
          fprintf(stderr, "invalid input: %s\n", parseError.localizedDescription.UTF8String);
          continue;
        }
        NSDictionary *output = Analyze(input);
        NSError *encodeError = nil;
        NSData *encoded = [NSJSONSerialization dataWithJSONObject:output options:0 error:&encodeError];
        if (encoded == nil) {
          fprintf(stderr, "encode failed: %s\n", encodeError.localizedDescription.UTF8String);
          continue;
        }
        fwrite(encoded.bytes, 1, encoded.length, stdout);
        fputc('\n', stdout);
        fflush(stdout);
      }
    }
    free(buffer);
  }
  return 0;
}
