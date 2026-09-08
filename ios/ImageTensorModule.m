#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(ImageTensorModule, NSObject)

RCT_EXTERN_METHOD(imageToTensor:(NSString *)uri
                  width:(double)width
                  height:(double)height
                  mean:(NSArray *)mean
                  std:(NSArray *)std
                  scale:(double)scale
                  channelOrder:(NSString *)channelOrder
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(cropImage:(NSString *)uri
                  x:(double)x
                  y:(double)y
                  width:(double)width
                  height:(double)height
                  outputPath:(NSString *)outputPath
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
