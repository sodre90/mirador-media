import { useState, type SyntheticEvent } from "react";
import { groupedItems } from "../shared/describe.ts";
import { fileName, isAudio, isPhoto, type Item } from "../shared/document.ts";
import { Composer, useMediaUrl } from "./parts.tsx";

export const itemMessage = ({ label, file }: Item, note: string) => `About ${label} (${file}): ${note.trim()}`;

/** Only one file plays at a time, so that the user compares them one after another. */
function pauseTheOthers(event: SyntheticEvent<HTMLMediaElement>) {
  for (const element of document.querySelectorAll<HTMLMediaElement>("audio, video")) if (element !== event.currentTarget) element.pause();
}

function Player({ item, onPlay }: { item: Item; onPlay: (event: SyntheticEvent<HTMLMediaElement>) => void }) {
  const url = useMediaUrl(item.file, null);
  if (!url) return <div className="item-media loading" />;
  if ("problem" in url) return <p className="item-media problem">{url.problem}</p>;
  if (isAudio(item.file)) return <audio className="item-media" src={url.url} controls preload="metadata" onPlay={onPlay} />;
  if (isPhoto(item.file)) return <img className="item-media" src={url.url} alt={item.label} />;
  return <video className="item-media" src={url.url} controls preload="metadata" playsInline onPlay={onPlay} />;
}

/** The files the agent listed, in their groups, each played in place; the one picked, or played last, is what the note is about. */
export function ItemsGrid({ items }: { items: Item[] }) {
  const [picked, setPicked] = useState<Item | null>(null);
  const current = picked && items.find((item) => item.file === picked.file);
  const send = async (note: string) => {
    if (!current) throw new Error("Pick a file first.");
    await window.mirador.prompt(itemMessage(current, note));
    return `Sent to the agent, about ${current.label}.`;
  };
  return (
    <main className="items">
      {groupedItems(items).map(({ group, items: grouped }) => (
        <section key={group ?? ""} aria-label={group ?? "Files"}>
          {group && <h2>{group}</h2>}
          <ul className="item-grid">
            {grouped.map((item) => (
              <li key={item.file} className={item === current ? "item picked" : "item"}>
                <button type="button" className="pick" aria-pressed={item === current} title={item.file} onClick={() => setPicked(item)}>
                  <strong>{item.label}</strong>
                  {item.label !== fileName(item.file) && <span className="item-file">{item.file}</span>}
                </button>
                <Player
                  item={item}
                  onPlay={(event) => {
                    pauseTheOthers(event);
                    setPicked(item);
                  }}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {current ? <Composer marked={<span className="hint">About {current.label}</span>} send={send} question={`What about ${current.label}`} /> : <p className="hint pick-hint">Play or pick one to tell the agent about it.</p>}
    </main>
  );
}
