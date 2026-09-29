"use client";

import { useState } from "react";
import {
  restaurantOptions,
  RESTAURANT_IDS,
} from "../../src/lib/restaurant-options";

export function RestaurantPicker({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const visible = restaurantOptions.filter((item) =>
    `${item.name} ${item.cuisine} ${item.area}`.toLowerCase().includes(query),
  );
  return (
    <fieldset className="restaurant-picker">
      <legend>Restaurants to consider</legend>
      <p>
        Choose your shortlist. Your group's confirmed requirements determine the
        recommendation. All {restaurantOptions.length} restaurants are fictional
        samples.
      </p>
      <label htmlFor="restaurant-search">Search by name, cuisine or area</label>
      <input
        id="restaurant-search"
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Try Italian, vegan or Riverside"
      />
      <div className="restaurant-picker-actions">
        <span role="status" aria-live="polite">
          {selected.length} of {restaurantOptions.length} selected ·{" "}
          {visible.length} shown
        </span>
        <button
          type="button"
          className="text-button"
          onClick={() => onChange([...RESTAURANT_IDS])}
        >
          Select all
        </button>
        <button
          type="button"
          className="text-button"
          onClick={() => onChange([])}
        >
          Clear selection
        </button>
      </div>
      <div className="restaurant-options">
        {visible.map((item) => (
          <label
            className={`restaurant-option ${selected.includes(item.id) ? "selected" : ""}`}
            key={item.id}
          >
            <input
              type="checkbox"
              checked={selected.includes(item.id)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...selected, item.id]
                    : selected.filter((id) => id !== item.id),
                )
              }
            />
            <span>
              <strong>{item.name}</strong>
              <small>
                {item.cuisine} · {item.area}
              </small>
              <small>
                ${item.price} / person · {item.deposit} MockUSDC group deposit
              </small>
            </span>
          </label>
        ))}
      </div>
      {visible.length === 0 && (
        <p>
          No restaurants match this search. Try another name, cuisine or area.
        </p>
      )}
      {selected.length === 0 && (
        <p className="flow-note" role="status">
          Select at least one restaurant to create your group.
        </p>
      )}
      <p className="flow-muted">
        Your shortlist is saved when the group is created. Availability, prices
        and dietary information are synthetic; no real booking is made.
      </p>
    </fieldset>
  );
}
