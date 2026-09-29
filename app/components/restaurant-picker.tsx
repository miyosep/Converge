"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { CatalogSearchResult } from "../../src/lib/catalog-search";
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

export function CategoryPicker({
  category,
  onCategoryChange,
}: {
  category: Category;
  onCategoryChange: (category: Category) => void;
}) {
  return (
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
  );
}

type PickerProps = {
  selected: string[];
  onChange: (ids: string[]) => void;
  category?: Category;
  onCategoryChange?: (category: Category) => void;
};

// Remount search state when a parent changes the category as well.
export function RestaurantPicker(props: PickerProps) {
  return (
    <CategoryRestaurantPicker key={props.category ?? "restaurant"} {...props} />
  );
}

function CategoryRestaurantPicker({
  selected,
  onChange,
  category = "restaurant",
  onCategoryChange,
}: PickerProps) {
  const [search, setSearch] = useState("");
  const [result, setResult] = useState<CatalogSearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const options = optionsForCategory(category);
  const info = categories[category];
  const visible = result
    ? options.filter((item) => result.ids.includes(item.id))
    : options;
  function resetSearch(text = "") {
    pending.current?.abort();
    pending.current = null;
    setSearch(text);
    setResult(null);
    setSearching(false);
    setSearchError("");
  }
  async function findPlaces() {
    if (!search.trim()) return;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setSearching(true);
    setSearchError("");
    setResult(null);
    try {
      const response = await fetch("/api/catalog/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, text: search }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(
          response.status === 401
            ? "Please sign in again to search with AI. Your selection is saved on this page."
            : "We couldn’t interpret your search. Please try again, or choose places from the list.",
        );
      }
      const data: CatalogSearchResult = await response.json();
      if (pending.current === controller) setResult(data);
    } catch (error) {
      if (pending.current === controller && !controller.signal.aborted)
        setSearchError(
          error instanceof Error
            ? error.message
            : "Search failed. Please try again.",
        );
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setSearching(false);
      }
    }
  }
  const count = options.filter((item) => selected.includes(item.id)).length;
  return (
    <fieldset className="restaurant-picker">
      <legend>
        {onCategoryChange
          ? "What are you planning?"
          : "Choose places to consider"}
      </legend>
      {category === "restaurant" && (
        <p className="flow-note">
          Looking for a real place?{" "}
          <Link href="/discover">
            Search real restaurants and compare candidates
          </Link>
          .
        </p>
      )}
      {onCategoryChange && (
        <CategoryPicker
          category={category}
          onCategoryChange={(next) => {
            resetSearch();
            onCategoryChange(next);
          }}
        />
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
        Prices are USD per {info.priceUnit}. Deposits are group totals in USDC.
        Availability and facilities are synthetic; no real booking is made.
      </p>
      <label htmlFor="restaurant-search">
        Describe what you’re looking for
      </label>
      <p id="catalog-search-help">
        Write a sentence about your budget, group size, area or facilities.
        We’ll show the conditions we understood and filter these example places.
        Search does not change your group’s confirmed requirements.
      </p>
      <textarea
        id="restaurant-search"
        rows={3}
        maxLength={2000}
        aria-describedby="catalog-search-help"
        value={search}
        onChange={(event) => resetSearch(event.target.value)}
        placeholder={
          category === "stay"
            ? "We need a place for 6 people under $50 per person per night, with parking and Wi-Fi."
            : `We’re looking for a place. ${info.example}`
        }
      />
      <div className="restaurant-picker-actions">
        <button
          type="button"
          className="primary"
          disabled={searching || !search.trim()}
          onClick={() => void findPlaces()}
        >
          {searching ? "Understanding your request…" : "Find matching places"}
        </button>
        <button
          type="button"
          className="text-button"
          onClick={() => resetSearch()}
          disabled={!search && !result}
        >
          Reset search
        </button>
      </div>
      <div role="status" aria-live="polite" aria-busy={searching}>
        {searching && (
          <p>Reading your sentence and checking the example catalog…</p>
        )}
        {result && (
          <div className="flow-note">
            <strong>Conditions understood</strong>
            {result.conditions.length > 0 && (
              <ul>
                {result.conditions.map((condition, index) => (
                  <li key={index}>{condition}</li>
                ))}
              </ul>
            )}
            {result.notices.length > 0 && (
              <>
                <strong>
                  Needs your attention — results only use the conditions above
                </strong>
                <ul>
                  {result.notices.map((notice, index) => (
                    <li key={index}>{notice}</li>
                  ))}
                </ul>
              </>
            )}
            <p>
              {visible.length} places match the searchable conditions. Review
              them before updating your shortlist.
            </p>
          </div>
        )}
      </div>
      {searchError && (
        <p role="alert" className="notice">
          {searchError}
        </p>
      )}
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
      {result && (
        <button
          type="button"
          className="secondary"
          disabled={!visible.length || !result.conditions.length}
          onClick={() => onChange(visible.map((item) => item.id))}
        >
          Use these {visible.length} matches as my shortlist
        </button>
      )}
      {result && !visible.length && (
        <p className="notice">
          No places match these conditions. Try changing your budget, area or
          facilities, or reset the search to see all places.
        </p>
      )}
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
                ${item.price} / {info.priceUnit} · {item.deposit} USDC group
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
