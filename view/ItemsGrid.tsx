import { useState, type SyntheticEvent } from "react";
import { groupedItems } from "../shared/describe.ts";
import { fileName, isAudio, isPhoto, type Item } from "../shared/document.ts";
import { Composer, useMediaUrl } from "./parts.tsx";

export const itemMessage = ({ label, file }: Item, note: string) => `About ${label} (${file}): ${note.trim()}`;

const describeChoice = ({ group, label, file }: Item) => `- ${group ? `${group}: ` : ""}${label} (${file})`;

export function choicesMessage(items: Item[], note: string) {
  const choices = `My choices:\n${items.filter((item) => item.chosen).map(describeChoice).join("\n")}`;
  return note.trim() === "" ? choices : `${choices}\n\n${note.trim()}`;
}

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

/** Chooses the file in its group, in place of the one chosen there, or takes the choice back. */
function ChooseButton({ item }: { item: Item }) {
  const where = item.group ? ` for ${item.group}` : "";
  return (
    <button
      type="button"
      className={item.chosen ? "choose on" : "choose"}
      aria-pressed={item.chosen}
      aria-label={`Choose ${item.label}${where}`}
      title={item.chosen ? "Take the choice back" : `Choose it${where}`}
      onClick={() => window.mirador.apply({ op: "choose", file: item.file, chosen: !item.chosen })}
    >
      {item.chosen ? "✓ Chosen" : "Choose"}
    </button>
  );
}

/** The files the agent listed, in their groups, each played in place; the one picked, or played last, is what the note is about. */
export function ItemsGrid({ items }: { items: Item[] }) {
  const [picked, setPicked] = useState<Item | null>(null);
  const current = (picked && items.find((item) => item.file === picked.file)) ?? null;
  const send = async (note: string) => {
    if (!current) throw new Error("Pick a file first.");
    await window.mirador.prompt(itemMessage(current, note));
    return `Sent to the agent, about ${current.label}.`;
  };
  const sendChoices = async (note: string) => {
    await window.mirador.prompt(choicesMessage(items, note));
    return "Sent your choices to the agent.";
  };
  return (
    <main className="items">
      {groupedItems(items).map(({ group, items: grouped }) => (
        <section key={group ?? ""} aria-label={group ?? "Files"}>
          {group && <h2>{group}</h2>}
          <ul className="item-grid">
            {grouped.map((item) => (
              <li key={item.file} className={["item", item === current && "picked", item.chosen && "chosen"].filter(Boolean).join(" ")}>
                <div className="item-head">
                  <button type="button" className="pick" aria-pressed={item === current} title={item.file} onClick={() => setPicked(item)}>
                    <strong>{item.label}</strong>
                    {item.label !== fileName(item.file) && <span className="item-file">{item.file}</span>}
                  </button>
                  <ChooseButton item={item} />
                </div>
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
      <Composer
        marked={<span className="hint">{current ? `About ${current.label}` : "Play or pick one to write about it"}</span>}
        send={send}
        ready={current !== null}
        question={current ? `What about ${current.label}` : "A note with your choices"}
        alsoSend={{ label: "Send my choices", enabled: items.some((item) => item.chosen), send: sendChoices }}
      />
    </main>
  );
}
