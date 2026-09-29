"use client";

import { useState } from "react";
import { Utensils, BedDouble, Building2, Trophy, Palette } from "lucide-react";
import {
  CATEGORY_IDS,
  categories,
  optionsForCategory,
  facilityLabels,
  type Category,
} from "../../src/lib/catalog-options";

const categoryIcons = {
  restaurant: Utensils,
  stay: BedDouble,
  space: Building2,
  sport: Trophy,
  class: Palette,
};

// The exported name is retained for existing ordinary-group consumers.
export function RestaurantPicker({
  selected,
  onChange,
  category = "restaurant",
  onCategoryChange,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
  category?: Category;
  onCategoryChange?: (category: Category) => void;
}) {
  const [search, setSearch] = useState("");
  const options = optionsForCategory(category);
  const info = categories[category];
  const query = search.trim().toLowerCase();
  const visible = options.filter((item) =>
    `${item.name} ${item.kind} ${item.area} ${item.facilities.map((facility) => facilityLabels[facility]).join(" ")}`
      .toLowerCase()
      .includes(query),
  );
  const count = options.filter((item) => selected.includes(item.id)).length;
  return (
    <fieldset className="restaurant-picker">
      <legend>What are you planning?</legend>
      {onCategoryChange && (
        <div
          className="category-options"
          role="group"
          aria-label="Booking category"
        >
          {CATEGORY_IDS.map((id) => {
            const Icon = categoryIcons[id];
            return (
              <button
                key={id}
                type="button"
                className={`category-option ${category === id ? "selected" : ""}`}
                aria-pressed={category === id}
                onClick={() => {
                  setSearch("");
                  onCategoryChange(id);
                }}
              >
                <Icon size={20} aria-hidden="true" />
                <strong>{categories[id].label}</strong>
                <small>{optionsForCategory(id).length} examples</small>
              </button>
            );
          })}
        </div>
      )}
      <div className="catalog-heading">
        <div>
          <h3>{info.label} to consider</h3>
          <p>{info.description}</p>
        </div>
        <span className="pill">{options.length} fictional samples</span>
      </div>
      <p>
        Choose your shortlist. Your group's confirmed requirements determine the
        recommendation. Switching categories starts a new shortlist.
      </p>
      <p className="flow-note">
        Prices are USD per {info.priceUnit}. Deposits are group totals in
        MockUSDC. Availability and facilities are synthetic; no real booking is
        made.
      </p>
      <label htmlFor="restaurant-search">
        Search by name, type, area or facility
      </label>
      <input
        id="restaurant-search"
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={
          category === "restaurant"
            ? "Try Italian, vegan or Riverside"
            : "Try a name, area or parking"
        }
      />
      <div className="restaurant-picker-actions">
        <span role="status" aria-live="polite">
          {count} of {options.length} selected · {visible.length} shown
        </span>
        <button
          type="button"
          className="text-button"
          onClick={() => onChange(options.map((item) => item.id))}
        >
          Select all {options.length}
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
                {item.kind} · {item.area}
              </small>
              <small>
                ${item.price} / {info.priceUnit} · {item.deposit} MockUSDC group
                deposit
              </small>
              {item.capacity !== undefined && (
                <small>
                  Up to {item.capacity} people
                  {item.beds ? ` · ${item.beds} beds` : ""}
                </small>
              )}
              {item.facilities.length > 0 && (
                <span className="catalog-facilities">
                  {item.facilities.map((facility) => (
                    <span key={facility}>{facilityLabels[facility]}</span>
                  ))}
                  {item.wheelchairAccessible && <span>Wheelchair access</span>}
                </span>
              )}
            </span>
          </label>
        ))}
      </div>
      {visible.length === 0 && (
        <p role="status">
          No candidates match this search. Try another name, type, area or
          facility.
        </p>
      )}
      {count === 0 && (
        <p className="flow-note" role="status">
          Select at least one candidate to create your group.
        </p>
      )}
      <p className="flow-muted">
        Your category and shortlist are saved when the group is created. To
        change them later, create a new group.
      </p>
    </fieldset>
  );
}
