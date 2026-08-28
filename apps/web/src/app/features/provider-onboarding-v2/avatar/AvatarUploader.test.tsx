import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { LanguageProvider } from '../../../i18n/LanguageContext';
import { AvatarUploader } from './AvatarUploader';
import { AVATAR_COPY } from '../copy/basics-copy';

// Sprint 9B.17 — the avatar control.
//
// The network and the canvas are both mocked here on purpose. What this file
// asserts is the CONTRACT the UI keeps with the provider:
//
//   - the three stages happen in order, and finalize is not optional
//   - nothing claims success until FINALIZE returns, because that is the only
//     point the server has actually looked at the bytes
//   - a failure is shown, is specific, and offers a retry that re-runs the
//     whole pipeline rather than resuming an expired upload
//   - remove and replace both work
//
// The refusals themselves (ownership, spoofed MIME, oversize) live server-side
// and are asserted in the API suite; a client test could only prove the client
// asked nicely.

const presignAvatar = vi.fn();
const putAvatarBytes = vi.fn();
const finalizeAvatar = vi.fn();
const removeAvatar = vi.fn();

vi.mock('../../../../lib/provider/provider-avatar-api', () => ({
  presignAvatar: (...args: unknown[]) => presignAvatar(...args),
  putAvatarBytes: (...args: unknown[]) => putAvatarBytes(...args),
  finalizeAvatar: (...args: unknown[]) => finalizeAvatar(...args),
  removeAvatar: (...args: unknown[]) => removeAvatar(...args),
  keyFromUploadUrl: (url: string) => url.replace(/^.*uploads\//, '').split('?')[0],
}));

const processAvatarImage = vi.fn();

vi.mock('./image-processing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./image-processing')>();
  return {
    ...actual,
    // happy-dom has no canvas encoder, so the real pipeline cannot run here.
    // Its own guards are unit-tested separately.
    processAvatarImage: (...args: unknown[]) => processAvatarImage(...args),
  };
});

const VIEW = { version: 4, data: { profileImageUrl: 'https://cdn.test/avatars/ref/new.jpg' } };

function pickFile(testId = 'avatar-input-gallery') {
  const input = screen.getByTestId(testId) as HTMLInputElement;
  const file = new File([new Uint8Array([1, 2, 3])], 'me.jpg', { type: 'image/jpeg' });
  fireEvent.change(input, { target: { files: [file] } });
  return file;
}

function renderUploader(
  props: Partial<React.ComponentProps<typeof AvatarUploader>> = {},
  lang: 'en' | 'ar' = 'en',
) {
  window.localStorage.setItem('hsm.lang', lang);
  return render(
    <LanguageProvider>
      <AvatarUploader
        imageUrl={null}
        version={3}
        lang={lang}
        onSaved={props.onSaved ?? vi.fn()}
        disabled={props.disabled ?? false}
        {...props}
      />
    </LanguageProvider>,
  );
}

beforeEach(() => {
  processAvatarImage.mockResolvedValue({
    blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }),
    contentType: 'image/jpeg',
    width: 512,
    height: 512,
    previewUrl: 'blob:preview',
  });
  presignAvatar.mockResolvedValue({
    uploadUrl: 'http://api.test/v1/media/uploads/avatars/ref/new.jpg?sig=x',
    fileUrl: 'http://api.test/v1/media/files/avatars/ref/new.jpg',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  putAvatarBytes.mockResolvedValue(undefined);
  finalizeAvatar.mockResolvedValue(VIEW);
  removeAvatar.mockResolvedValue({ version: 5, data: { profileImageUrl: null } });
  // jsdom/happy-dom do not implement these.
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:preview');
  globalThis.URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe('AvatarUploader — the happy path', () => {
  it('presigns for the AVATAR purpose, uploads, then finalizes with the KEY', async () => {
    const onSaved = vi.fn();
    renderUploader({ onSaved });
    pickFile();

    await waitFor(() => expect(finalizeAvatar).toHaveBeenCalled());

    expect(presignAvatar).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: 'image/jpeg' }),
    );
    expect(putAvatarBytes).toHaveBeenCalled();
    // A KEY, never a URL: the server recomputes the URL from a key it minted,
    // so a client-supplied one would be a pointer nobody validated.
    expect(finalizeAvatar).toHaveBeenCalledWith({ key: 'avatars/ref/new.jpg', version: 3 });
    expect(onSaved).toHaveBeenCalledWith(VIEW);
  });

  it('does NOT report success when the upload lands but finalize fails', async () => {
    // The assertion this component exists for. The PUT succeeding means the
    // bytes are somewhere; it does not mean the server accepted them.
    const onSaved = vi.fn();
    finalizeAvatar.mockRejectedValue({
      response: { data: { error: { details: { reason: 'CONTENT_MISMATCH' } } } },
    });
    renderUploader({ onSaved });
    pickFile();

    await waitFor(() => expect(screen.getByTestId('avatar-retry')).toBeInTheDocument());
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByText(AVATAR_COPY.en.failure.CONTENT_MISMATCH)).toBeInTheDocument();
  });

  it('shows progress while the bytes are in flight', async () => {
    let report: ((f: number) => void) | undefined;
    putAvatarBytes.mockImplementation(
      (_blob: Blob, _url: string, opts: { onProgress?: (f: number) => void }) => {
        report = opts.onProgress;
        return new Promise(() => {});
      },
    );
    renderUploader();
    pickFile();

    await waitFor(() => expect(report).toBeDefined());
    report!(0.5);
    await waitFor(() =>
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50'),
    );
  });
});

describe('AvatarUploader — failures', () => {
  it('names the specific server refusal rather than a generic message', async () => {
    finalizeAvatar.mockRejectedValue({
      response: { data: { error: { details: { reason: 'NOT_AN_AVATAR_KEY' } } } },
    });
    renderUploader();
    pickFile();

    expect(await screen.findByText(AVATAR_COPY.en.failure.NOT_AN_AVATAR_KEY)).toBeInTheDocument();
  });

  it('reports a client-side processing refusal without touching the network', async () => {
    const { ImageProcessingError } = await import('./image-processing');
    processAvatarImage.mockRejectedValue(new ImageProcessingError('UNSUPPORTED_TYPE'));
    renderUploader();
    pickFile();

    expect(await screen.findByText(AVATAR_COPY.en.failure.UNSUPPORTED_TYPE)).toBeInTheDocument();
    expect(presignAvatar).not.toHaveBeenCalled();
  });

  it('retries the WHOLE pipeline, because a presigned URL expires', async () => {
    finalizeAvatar.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(VIEW);
    renderUploader();
    pickFile();

    fireEvent.click(await screen.findByTestId('avatar-retry'));

    await waitFor(() => expect(presignAvatar).toHaveBeenCalledTimes(2));
    expect(finalizeAvatar).toHaveBeenCalledTimes(2);
  });
});

describe('AvatarUploader — replace and remove', () => {
  it('offers Replace rather than Choose once a photo exists', () => {
    renderUploader({ imageUrl: 'https://cdn.test/avatars/ref/old.jpg' });
    expect(screen.getByTestId('avatar-choose-file').textContent).toContain(AVATAR_COPY.en.replace);
  });

  it('removes through the versioned endpoint', async () => {
    const onSaved = vi.fn();
    renderUploader({ imageUrl: 'https://cdn.test/avatars/ref/old.jpg', onSaved });

    fireEvent.click(screen.getByTestId('avatar-remove'));

    await waitFor(() => expect(removeAvatar).toHaveBeenCalledWith(3));
    expect(onSaved).toHaveBeenCalled();
  });

  it('shows no remove control when there is nothing to remove', () => {
    renderUploader({ imageUrl: null });
    expect(screen.queryByTestId('avatar-remove')).toBeNull();
  });

  it('disables every control while the application is locked', () => {
    renderUploader({ imageUrl: 'https://cdn.test/avatars/ref/old.jpg', disabled: true });
    expect(screen.getByTestId('avatar-take-photo')).toBeDisabled();
    expect(screen.getByTestId('avatar-choose-file')).toBeDisabled();
    expect(screen.getByTestId('avatar-remove')).toBeDisabled();
  });
});

describe('AvatarUploader — Arabic', () => {
  it('renders Arabic labels', () => {
    renderUploader({ imageUrl: 'https://cdn.test/avatars/ref/old.jpg' }, 'ar');
    expect(screen.getByTestId('avatar-take-photo').textContent).toContain(AVATAR_COPY.ar.takePhoto);
    expect(screen.getByTestId('avatar-remove').textContent).toContain(AVATAR_COPY.ar.remove);
  });

  it('reports failures in Arabic', async () => {
    finalizeAvatar.mockRejectedValue({
      response: { data: { error: { details: { reason: 'CONTENT_MISMATCH' } } } },
    });
    renderUploader({}, 'ar');
    pickFile();

    expect(await screen.findByText(AVATAR_COPY.ar.failure.CONTENT_MISMATCH)).toBeInTheDocument();
  });
});
