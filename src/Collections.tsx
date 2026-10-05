import { useState } from "react";
import {
  Plus,
  Table2,
  Columns3,
  CalendarDays,
  List,
  LayoutGrid,
  Trash2,
} from "lucide-react";
import { uid, type Collection, type Field, type Workspace } from "./types";
export default function Collections({
  data,
  update,
  notify,
}: {
  data: Workspace;
  update: (f: (d: Workspace) => Workspace) => void;
  notify: (s: string) => void;
}) {
  const [active, setActive] = useState(data.collections[0]?.id || "");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [fieldName, setFieldName] = useState("");
  const [fieldType, setFieldType] = useState<Field["type"]>("text");
  const [options, setOptions] = useState("Not started,Working,Done");
  const [colName, setColName] = useState("");
  const c =
    data.collections.find((c) => c.id === active) || data.collections[0];
  const edit = (fn: (c: Collection) => Collection) => {
    if (c)
      update((d) => ({
        ...d,
        collections: d.collections.map((x) => (x.id === c.id ? fn(x) : x)),
      }));
  };
  function create(template: boolean) {
    const id = uid();
    const fields: Field[] = template
      ? [
          { id: uid(), name: "Name", type: "text" },
          { id: uid(), name: "Course / project", type: "text" },
          { id: uid(), name: "Due", type: "date" },
          {
            id: uid(),
            name: "Status",
            type: "select",
            options: ["Not started", "Working", "Done"],
          },
        ]
      : [{ id: uid(), name: "Name", type: "text" }];
    update((d) => ({
      ...d,
      collections: [
        ...d.collections,
        {
          id,
          name: name.trim() || "Untitled collection",
          fields,
          rows: [],
          view: "table",
        },
      ],
    }));
    setActive(id);
    setAdding(false);
    setName("");
  }
  function input(row: Collection["rows"][number], field: Field) {
    const value = row.values[field.id] ?? "";
    const change = (v: string | boolean) =>
      edit((c) => ({
        ...c,
        rows: c.rows.map((r) =>
          r.id === row.id
            ? { ...r, values: { ...r.values, [field.id]: v } }
            : r,
        ),
      }));
    return field.type === "checkbox" ? (
      <input
        aria-label={field.name}
        type="checkbox"
        checked={!!value}
        onChange={(e) => change(e.target.checked)}
      />
    ) : field.type === "select" ? (
      <select
        aria-label={field.name}
        value={String(value)}
        onChange={(e) => change(e.target.value)}
      >
        <option value="">Choose…</option>
        {field.options?.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    ) : (
      <input
        aria-label={field.name}
        type={
          field.type === "date"
            ? "date"
            : field.type === "number"
              ? "number"
              : field.type === "url"
                ? "url"
                : "text"
        }
        value={String(value)}
        placeholder={field.type === "text" ? "Empty" : ""}
        onChange={(e) => change(e.target.value)}
      />
    );
  }
  const groupField = c?.fields.find((f) => f.type === "select");
  const dateField = c?.fields.find((f) => f.type === "date");
  const addRow = () =>
    edit((c) => ({ ...c, rows: [...c.rows, { id: uid(), values: {} }] }));
  return (
    <section className="workspace-view">
      <div className="view-heading">
        <div>
          <div className="eyebrow">A PLACE FOR THE DETAILS</div>
          <h1>Collections</h1>
          <p>Assignments, projects, reading lists. Organized your way.</p>
        </div>
        <button className="primary" onClick={() => setAdding(true)}>
          <Plus size={17} /> New collection
        </button>
      </div>
      {adding && (
        <div className="inline-form">
          <input
            autoFocus
            placeholder="Collection name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="primary" onClick={() => create(true)}>
            Assignment tracker
          </button>
          <button onClick={() => create(false)}>Blank collection</button>
          <button onClick={() => setAdding(false)}>Cancel</button>
        </div>
      )}
      <div className="collection-tabs">
        {data.collections.map((x) => (
          <button
            className={x.id === c?.id ? "active" : ""}
            key={x.id}
            onClick={() => setActive(x.id)}
          >
            <Table2 size={16} />
            {x.name}
          </button>
        ))}
      </div>
      {!c ? (
        <div className="empty-state">
          <Table2 size={38} />
          <h2>Structure without the spreadsheet sprawl.</h2>
          <p>
            Create a collection to track assignments, books, or anything else.
          </p>
          <button className="primary" onClick={() => setAdding(true)}>
            Create a collection
          </button>
        </div>
      ) : (
        <>
          <div className="collection-toolbar">
            <input
              aria-label="Collection title"
              className="collection-title"
              value={c.name}
              onChange={(e) => edit((c) => ({ ...c, name: e.target.value }))}
            />
            <div className="segmented">
              {(
                [
                  ["table", Table2],
                  ["board", Columns3],
                  ["calendar", CalendarDays],
                  ["list", List],
                  ["gallery", LayoutGrid],
                ] as const
              ).map(([v, Icon]) => (
                <button
                  key={v}
                  title={v}
                  aria-label={v + " view"}
                  className={c.view === v ? "active" : ""}
                  onClick={() => edit((c) => ({ ...c, view: v }))}
                >
                  <Icon size={17} />
                  <span>{v}</span>
                </button>
              ))}
            </div>
            <button onClick={addRow}>
              <Plus size={16} /> Row
            </button>
          </div>
          {c.view === "table" ? (
            <div className="table-scroll">
              <table className="collection-table">
                <thead>
                  <tr>
                    {c.fields.map((f) => (
                      <th key={f.id}>
                        {f.name}
                        <small>{f.type}</small>
                      </th>
                    ))}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {c.rows.map((r) => (
                    <tr key={r.id}>
                      {c.fields.map((f) => (
                        <td key={f.id}>{input(r, f)}</td>
                      ))}
                      <td>
                        <button
                          aria-label="Delete row"
                          onClick={() =>
                            edit((c) => ({
                              ...c,
                              rows: c.rows.filter((x) => x.id !== r.id),
                            }))
                          }
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!c.rows.length && (
                <button className="add-table-row" onClick={addRow}>
                  <Plus size={17} /> Add your first row
                </button>
              )}
            </div>
          ) : c.view === "board" ? (
            groupField ? (
              <div className="board">
                {["", ...(groupField.options || [])].map((group) => (
                  <div
                    className="board-column"
                    key={group}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      const id = e.dataTransfer.getData("slate-row");
                      edit((c) => ({
                        ...c,
                        rows: c.rows.map((r) =>
                          r.id === id
                            ? {
                                ...r,
                                values: { ...r.values, [groupField.id]: group },
                              }
                            : r,
                        ),
                      }));
                    }}
                  >
                    <div className="board-heading">
                      {group || "Unassigned"}
                      <small>
                        {
                          c.rows.filter(
                            (r) => (r.values[groupField.id] || "") === group,
                          ).length
                        }
                      </small>
                    </div>
                    {c.rows
                      .filter((r) => (r.values[groupField.id] || "") === group)
                      .map((r) => (
                        <article
                          draggable
                          onDragStart={(e) =>
                            e.dataTransfer.setData("slate-row", r.id)
                          }
                          className="board-card"
                          key={r.id}
                        >
                          {c.fields
                            .filter((f) => f.id !== groupField.id)
                            .map((f) => (
                              <label key={f.id}>
                                <small>{f.name}</small>
                                {input(r, f)}
                              </label>
                            ))}
                          <select
                            aria-label="Move card"
                            value={String(r.values[groupField.id] || "")}
                            onChange={(e) =>
                              edit((c) => ({
                                ...c,
                                rows: c.rows.map((x) =>
                                  x.id === r.id
                                    ? {
                                        ...x,
                                        values: {
                                          ...x.values,
                                          [groupField.id]: e.target.value,
                                        },
                                      }
                                    : x,
                                ),
                              }))
                            }
                          >
                            <option value="">Unassigned</option>
                            {groupField.options?.map((o) => (
                              <option key={o}>{o}</option>
                            ))}
                          </select>
                        </article>
                      ))}
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <p>Add a Select field to group cards into a board.</p>
              </div>
            )
          ) : c.view === "calendar" ? (
            dateField ? (
              <div className="calendar-list">
                {[
                  ...new Set(
                    c.rows.map((r) => String(r.values[dateField.id] || "")),
                  ),
                ]
                  .sort()
                  .map((date) => (
                    <section key={date}>
                      <h3>
                        {date
                          ? new Date(date + "T12:00:00").toLocaleDateString(
                              undefined,
                              {
                                weekday: "long",
                                month: "long",
                                day: "numeric",
                              },
                            )
                          : "No date"}
                      </h3>
                      {c.rows
                        .filter(
                          (r) => String(r.values[dateField.id] || "") === date,
                        )
                        .map((r) => (
                          <div className="calendar-item" key={r.id}>
                            {c.fields.map((f) => (
                              <label key={f.id}>
                                <small>{f.name}</small>
                                {input(r, f)}
                              </label>
                            ))}
                          </div>
                        ))}
                    </section>
                  ))}
              </div>
            ) : (
              <div className="empty-state">
                <p>Add a Date field to see a calendar agenda.</p>
              </div>
            )
          ) : (
            <div
              className={c.view === "gallery" ? "gallery" : "collection-list"}
            >
              {c.rows.map((r) => (
                <article className="collection-card" key={r.id}>
                  {c.fields.map((f) => (
                    <label key={f.id}>
                      <small>{f.name}</small>
                      {input(r, f)}
                    </label>
                  ))}
                  <button
                    aria-label="Delete row"
                    onClick={() =>
                      edit((c) => ({
                        ...c,
                        rows: c.rows.filter((x) => x.id !== r.id),
                      }))
                    }
                  >
                    <Trash2 size={16} />
                  </button>
                </article>
              ))}
            </div>
          )}
          <details className="field-settings">
            <summary>Collection settings</summary>
            <div className="inline-form">
              <input
                placeholder="New field name"
                value={fieldName}
                onChange={(e) => setFieldName(e.target.value)}
              />
              <select
                aria-label="Field type"
                value={fieldType}
                onChange={(e) => setFieldType(e.target.value as Field["type"])}
              >
                {["text", "number", "date", "checkbox", "select", "url"].map(
                  (t) => (
                    <option key={t}>{t}</option>
                  ),
                )}
              </select>
              {fieldType === "select" && (
                <input
                  aria-label="Select options"
                  value={options}
                  onChange={(e) => setOptions(e.target.value)}
                  placeholder="Options, separated by commas"
                />
              )}
              <button
                onClick={() => {
                  if (!fieldName.trim()) return;
                  edit((c) => ({
                    ...c,
                    fields: [
                      ...c.fields,
                      {
                        id: uid(),
                        name: fieldName.trim(),
                        type: fieldType,
                        ...(fieldType === "select"
                          ? {
                              options: options
                                .split(",")
                                .map((x) => x.trim())
                                .filter(Boolean),
                            }
                          : {}),
                      },
                    ],
                  }));
                  setFieldName("");
                }}
              >
                Add field
              </button>
            </div>
            <p>Fields: {c.fields.map((f) => f.name).join(" · ")}</p>
            <button
              className="danger"
              onClick={() => {
                if (
                  confirm(
                    `Delete collection “${c.name}” and its rows? Export a backup first if you need a copy.`,
                  )
                ) {
                  update((d) => ({
                    ...d,
                    collections: d.collections.filter((x) => x.id !== c.id),
                  }));
                  notify("Collection deleted");
                }
              }}
            >
              Delete collection
            </button>
          </details>
        </>
      )}
    </section>
  );
}
