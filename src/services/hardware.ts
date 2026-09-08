import { Platform } from 'react-native';
import DeviceInfo from 'react-native-device-info';

import { DeviceInfo as DeviceInfoType, SoCInfo, SoCVendor } from '../types';

class HardwareService {
  private cachedDeviceInfo: DeviceInfoType | null = null;
  private cachedSoCInfo: SoCInfo | null = null;

  async getDeviceInfo(): Promise<DeviceInfoType> {
    if (this.cachedDeviceInfo) {
      return this.cachedDeviceInfo;
    }

    const [
      totalMemory,
      usedMemory,
      deviceModel,
      systemName,
      systemVersion,
      isEmulator,
    ] = await Promise.all([
      DeviceInfo.getTotalMemory(),
      DeviceInfo.getUsedMemory(),
      DeviceInfo.getModel(),
      DeviceInfo.getSystemName(),
      DeviceInfo.getSystemVersion(),
      DeviceInfo.isEmulator(),
    ]);

    this.cachedDeviceInfo = {
      totalMemory,
      usedMemory,
      availableMemory: totalMemory - usedMemory,
      deviceModel,
      systemName,
      systemVersion,
      isEmulator,
    };

    return this.cachedDeviceInfo;
  }

  async refreshMemoryInfo(): Promise<DeviceInfoType> {
    // Force fresh fetch of all memory info
    const [totalMemory, usedMemory] = await Promise.all([
      DeviceInfo.getTotalMemory(),
      DeviceInfo.getUsedMemory(),
    ]);

    if (!this.cachedDeviceInfo) {
      await this.getDeviceInfo();
    }

    if (this.cachedDeviceInfo) {
      this.cachedDeviceInfo.totalMemory = totalMemory;
      this.cachedDeviceInfo.usedMemory = usedMemory;
      this.cachedDeviceInfo.availableMemory = totalMemory - usedMemory;
    }

    return this.cachedDeviceInfo!;
  }

  /**
   * Get app-specific memory usage (more accurate for tracking model memory)
   */
  async getAppMemoryUsage(): Promise<{ used: number; available: number; total: number }> {
    const total = await DeviceInfo.getTotalMemory();
    const used = await DeviceInfo.getUsedMemory();
    return {
      used,
      available: total - used,
      total,
    };
  }

  getTotalMemoryGB(): number {
    if (!this.cachedDeviceInfo) {
      return 4; // Default assumption
    }
    return this.cachedDeviceInfo.totalMemory / (1024 * 1024 * 1024);
  }

  getAvailableMemoryGB(): number {
    if (!this.cachedDeviceInfo) {
      return 2; // Default assumption
    }
    return this.cachedDeviceInfo.availableMemory / (1024 * 1024 * 1024);
  }

  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));

    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
  }

  private detectAppleChip(deviceId: string): SoCInfo['appleChip'] {
    const match = deviceId.match(/iPhone(\d+)/);
    if (!match) return undefined;
    const major = parseInt(match[1], 10);
    if (major >= 17) return 'A18';
    if (major >= 16) return 'A17Pro';
    if (major >= 15) return 'A16';
    if (major >= 14) return 'A15';
    if (major >= 13) return 'A14';
    return undefined;
  }

  async getSoCInfo(): Promise<SoCInfo> {
    if (this.cachedSoCInfo) return this.cachedSoCInfo;
    if (Platform.OS === 'ios') {
      const ramGB = this.getTotalMemoryGB();
      const appleChip = this.detectAppleChip(DeviceInfo.getDeviceId()) ?? (ramGB >= 6 ? 'A15' : 'A14');
      this.cachedSoCInfo = { vendor: 'apple', hasNPU: true, appleChip };
      return this.cachedSoCInfo;
    }
    const hardware = await DeviceInfo.getHardware();
    const model = DeviceInfo.getModel();
    const hw = hardware.toLowerCase();
    let vendor: SoCVendor = 'unknown';
    if (hw.includes('qcom')) vendor = 'qualcomm';
    else if (model.startsWith('Pixel')) vendor = 'tensor';
    else if (hw.includes('mt') || hw.includes('mediatek')) vendor = 'mediatek';
    else if (hw.includes('exynos') || hw.includes('samsungexynos')) vendor = 'exynos';
    const qnnVariant =
      vendor === 'qualcomm'
        ? this.getTotalMemoryGB() >= 12
          ? '8gen1'
          : 'min'
        : undefined;
    this.cachedSoCInfo = { vendor, hasNPU: vendor === 'qualcomm', qnnVariant };
    return this.cachedSoCInfo;
  }

  getDeviceTier(): 'low' | 'medium' | 'high' | 'flagship' {
    const ramGB = this.getTotalMemoryGB();

    if (ramGB < 4) return 'low';
    if (ramGB < 6) return 'medium';
    if (ramGB < 8) return 'high';
    return 'flagship';
  }
}

export const hardwareService = new HardwareService();
