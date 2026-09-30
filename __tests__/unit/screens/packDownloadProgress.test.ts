import {
  describeDownloadAmount,
  describeDownloadStage,
  progressReporter,
} from '../../../src/screens/packDownloadProgress';

const MODEL_BYTES = 204_011_297;
const PACK_BYTES = 228_081_202;

describe('pack download progress text', () => {
  it('describes the preparation step before any transfer has started', () => {
    expect(describeDownloadStage(null)).toBe('Preparing download...');
    expect(describeDownloadAmount(null)).toBeNull();
  });

  it('shows the percentage and 1024-based megabytes, like the pack card', () => {
    const progress = { stage: 'model' as const, bytesWritten: 85_684_745, contentLength: MODEL_BYTES };

    expect(describeDownloadStage(progress)).toBe('Downloading identification model...');
    expect(describeDownloadAmount(progress)).toBe('42% (81.7 of 194.6 MB)');
  });

  it('switches to verification once every byte has arrived', () => {
    const progress = { stage: 'pack' as const, bytesWritten: PACK_BYTES, contentLength: PACK_BYTES };

    expect(describeDownloadStage(progress)).toBe('Verifying and installing embedding pack...');
    expect(describeDownloadAmount(progress)).toBeNull();
  });

  it('shows only the received amount when the server sent no length', () => {
    const progress = { stage: 'pack' as const, bytesWritten: 12 * 1024 * 1024, contentLength: 0 };

    expect(describeDownloadStage(progress)).toBe('Downloading embedding pack...');
    expect(describeDownloadAmount(progress)).toBe('12.0 MB');
  });

  it('hides the amount until the first bytes arrive', () => {
    expect(
      describeDownloadAmount({ stage: 'pack', bytesWritten: 0, contentLength: PACK_BYTES }),
    ).toBeNull();
  });

  it('tags service progress with its stage', () => {
    const onChange = jest.fn();

    progressReporter('model', onChange)(10, 20);

    expect(onChange).toHaveBeenCalledWith({ stage: 'model', bytesWritten: 10, contentLength: 20 });
  });
});
