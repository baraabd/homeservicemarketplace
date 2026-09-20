import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import { CaseNotice } from '../../case-ui/CasePrimitives';
import { disputeKeys, caseErrorStatus } from '../api';
import { uploadCaseEvidence } from './api';
import { WORKSPACE_COPY, translatedLabel } from './copy';
export function EvidenceUpload({
  caseId,
  admin,
  lang,
  disabled,
  sourceId,
}: {
  caseId: string;
  admin: boolean;
  lang: 'en' | 'ar';
  disabled: boolean;
  sourceId?: string;
}) {
  const t = WORKSPACE_COPY[lang],
    qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [invalid, setInvalid] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const intent = useRef<string | null>(null);
  const mutation = useMutation({
    networkMode: 'always',
    retry: false,
    mutationFn: async () => {
      if (!file) throw new Error('No evidence selected');
      intent.current ??= crypto.randomUUID();
      return uploadCaseEvidence(caseId, admin, file, intent.current, sourceId);
    },
    onSuccess: async (result) => {
      if (result.state !== 'PREPARED') {
        setFile(null);
        intent.current = null;
        if (input.current) input.current.value = '';
      }
      await qc.invalidateQueries({ queryKey: disputeKeys.root });
    },
  });
  const uncertain =
    mutation.isError &&
    (caseErrorStatus(mutation.error) === undefined ||
      (caseErrorStatus(mutation.error) ?? 0) >= 500);
  return (
    <form
      className="cw-file cw-box"
      onSubmit={(e) => {
        e.preventDefault();
        if (!file || file.size > 5 * 1024 * 1024 || file.size === 0) {
          setInvalid(true);
          return;
        }
        if (!disabled && !mutation.isPending) void mutation.mutateAsync().catch(() => undefined);
      }}
    >
      <label className="case-field">
        {sourceId ? t.redactedUpload : t.chooseFile}
        <input
          ref={input}
          type="file"
          accept={sourceId ? 'image/png' : '.png,.jpg,.jpeg,.pdf'}
          disabled={disabled || mutation.isPending || uncertain}
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            intent.current = null;
            mutation.reset();
            setInvalid(false);
          }}
        />
      </label>
      <p className="cw-meta">{sourceId ? t.redactedHint : t.uploadHint}</p>
      {file && (
        <p className="cw-meta">
          {t.selectedFile}: <bdi dir="auto">{file.name}</bdi>
        </p>
      )}
      {(invalid || mutation.isError) && (
        <CaseNotice alert>{invalid ? t.uploadHint : t.uploadFailed}</CaseNotice>
      )}
      {mutation.isSuccess && (
        <p role="status">
          {mutation.data.state === 'PREPARED'
            ? t.evidenceStates.PREPARED
            : translatedLabel(t.evidenceStates, mutation.data.state, t.uploaded)}
        </p>
      )}
      <button
        className="case-button"
        type="submit"
        disabled={disabled || mutation.isPending || !file}
      >
        <Upload size={17} aria-hidden="true" />
        {mutation.isPending ? t.uploading : uncertain ? t.retry : t.sendFile}
      </button>
    </form>
  );
}
