import { useEffect, useRef, useState } from "react";
import { api, RoomImage, roomImageUrl } from "../api";

const MAX = 3;

// A photo picked before the room exists yet (creation flow). `data` is base64 (no
// data-URL prefix) ready for the upload endpoint; `preview` is a full data URL for <img>.
export type PendingImage = { content_type: string; data: string; preview: string };

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve((r.result as string).split(",")[1] ?? "");
    r.onerror = () => reject(new Error("read error"));
    r.readAsDataURL(file);
  });
}

type Props =
  // Edit mode: room exists, talk to the server directly.
  | { roomId: number; pending?: undefined; onPendingChange?: undefined }
  // Create mode: no room yet, buffer picks locally; parent uploads after creating the room.
  | { roomId?: undefined; pending: PendingImage[]; onPendingChange: (imgs: PendingImage[]) => void };

export default function RoomImages(props: Props) {
  const staging = props.roomId === undefined;
  const [images, setImages] = useState<RoomImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!staging) api.listRoomImages(props.roomId).then(setImages);
  }, [staging ? undefined : props.roomId]);

  const count = staging ? props.pending.length : images.length;

  const onFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith("image/"));
    e.target.value = "";
    if (picked.length === 0) return;
    if (count + picked.length > MAX) {
      setError(`Не более ${MAX} фото на помещение.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const encoded = await Promise.all(
        picked.map(async (f) => ({ content_type: f.type, data: await fileToBase64(f) })),
      );
      if (staging) {
        props.onPendingChange([
          ...props.pending,
          ...encoded.map((p) => ({ ...p, preview: `data:${p.content_type};base64,${p.data}` })),
        ]);
      } else {
        await api.uploadRoomImages(props.roomId, encoded);
        setImages(await api.listRoomImages(props.roomId));
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const removeStaged = (idx: number) => {
    props.onPendingChange!(props.pending!.filter((_, i) => i !== idx));
  };

  const removeServer = async (imageId: number) => {
    setBusy(true);
    setError(null);
    try {
      await api.deleteRoomImage(props.roomId!, imageId);
      setImages(await api.listRoomImages(props.roomId!));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="field">
      <label>Фотографии помещения ({count}/{MAX})</label>
      <div className="img-grid">
        {staging
          ? props.pending.map((img, idx) => (
              <div className="img-thumb" key={idx}>
                <img src={img.preview} alt="" loading="lazy" />
                <button
                  type="button"
                  className="img-del"
                  title="Удалить"
                  disabled={busy}
                  onClick={() => removeStaged(idx)}
                >
                  ✕
                </button>
              </div>
            ))
          : images.map((img) => (
              <div className="img-thumb" key={img.id}>
                <img src={roomImageUrl(props.roomId!, img.id)} alt="" loading="lazy" />
                <button
                  type="button"
                  className="img-del"
                  title="Удалить"
                  disabled={busy}
                  onClick={() => removeServer(img.id)}
                >
                  ✕
                </button>
              </div>
            ))}
        {count < MAX && (
          <button
            type="button"
            className="img-add"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            <span>+</span>
            <small>{busy ? "Загрузка…" : "Добавить"}</small>
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: "none" }}
        onChange={onFiles}
      />
      <span className="field-hint">Показываются заказчику в боте при выборе помещения. До 5 МБ каждое.</span>
      {error && <div className="error">{error}</div>}
    </div>
  );
}
