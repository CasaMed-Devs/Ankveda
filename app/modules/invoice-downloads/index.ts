import { requireOptionalNativeModule } from 'expo';

type InvoiceDownloadsModule = {
  /** True on Android 10+, where files can be saved to Downloads without a picker or permission. */
  isSupported: boolean;
  /** Copies a local file:// into the public Downloads folder; resolves to its content:// URI. */
  saveToDownloads(sourceUri: string, fileName: string, mimeType: string): Promise<string>;
};

/** Null on iOS, and in an app binary built before this module was added. */
const native = requireOptionalNativeModule<InvoiceDownloadsModule>('InvoiceDownloads');

export const canSaveToDownloads = (): boolean => native?.isSupported === true;

export const saveToDownloads = (sourceUri: string, fileName: string, mimeType: string): Promise<string> => {
  if (!native) throw new Error('Saving to Downloads is not available in this app version.');
  return native.saveToDownloads(sourceUri, fileName, mimeType);
};
