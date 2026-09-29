"use client";
import { Plus } from "lucide-react";
import { CategoryPicker } from "./restaurant-picker";
import {
  categories,
  optionsForCategory,
  type Category,
} from "../../src/lib/catalog-options";
import {
  groupSizeSchema,
  MIN_GROUP_MEMBERS,
  MAX_GROUP_MEMBERS,
} from "../../src/lib/group-size";
export type PlanBuilderProps = {
  name: string;
  setName: (value: string) => void;
  displayName: string;
  setDisplayName: (value: string) => void;
  when: string;
  setWhen: (value: string) => void;
  sizeInput: string;
  setSizeInput: (value: string) => void;
  category: Category;
  setCategory: (value: Category) => void;
  initialPreferences: string;
  setInitialPreferences: (value: string) => void;
  setPermittedRestaurantIds: (value: string[]) => void;
  busy: boolean;
  onCreate: () => void;
};
export function PlanBuilder({
  name,
  setName,
  displayName,
  setDisplayName,
  when,
  setWhen,
  sizeInput,
  setSizeInput,
  category,
  setCategory,
  initialPreferences,
  setInitialPreferences,
  setPermittedRestaurantIds,
  busy,
  onCreate,
}: PlanBuilderProps) {
  const validSize = groupSizeSchema.safeParse(Number(sizeInput)).success;
  const validWhen =
    !!when &&
    Number.isFinite(new Date(when).getTime()) &&
    new Date(when).getTime() > Date.now();
  return (
    <>
      <h2>What do you have in mind?</h2>
      <fieldset disabled={busy} className="plan-basics">
        <CategoryPicker
          category={category}
          onCategoryChange={(next) => {
            setCategory(next);
            setPermittedRestaurantIds(
              optionsForCategory(next).map((option) => option.id),
            );
          }}
        />
        <div className="form-grid">
          <label>
            Group name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={categories[category].groupName}
              maxLength={100}
            />
          </label>
          <label>
            Your display name
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Alice"
              maxLength={80}
            />
          </label>
          <label>
            When are you getting together?
            <input
              type="datetime-local"
              aria-invalid={!!when && !validWhen}
              aria-describedby="plan-time-help"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
            />
            <small id="plan-time-help">
              {when && !validWhen
                ? "Choose a date and time in the future."
                : "Shown in your local time zone."}
            </small>
          </label>
          <label>
            Group size, including you
            <input
              type="number"
              min={MIN_GROUP_MEMBERS}
              max={MAX_GROUP_MEMBERS}
              step={1}
              value={sizeInput}
              onChange={(event) => setSizeInput(event.target.value)}
              aria-describedby="group-size-help"
              aria-invalid={!validSize}
            />
            <small id="group-size-help">
              {validSize
                ? `Invite ${Number(sizeInput) - 1} others. Everyone must confirm before recommendations are ready.`
                : `Enter a whole number from ${MIN_GROUP_MEMBERS} to ${MAX_GROUP_MEMBERS}.`}
            </small>
          </label>
        </div>
        <label htmlFor="initial-preferences">
          Your starting preferences (optional)
        </label>
        <p id="initial-preferences-help">
          Add your budget, preferred area or anything that matters to you. This
          is your starting suggestion. Everyone adds their own preferences
          before places are recommended.
        </p>
        <textarea
          id="initial-preferences"
          rows={3}
          maxLength={4000}
          aria-describedby="initial-preferences-help"
          value={initialPreferences}
          onChange={(event) => setInitialPreferences(event.target.value)}
          placeholder={categories[category].example}
        />
      </fieldset>
      <div className="builder-actions">
        <span>Get an invite link, then decide together.</span>
        <button
          className="primary"
          onClick={onCreate}
          disabled={
            busy ||
            !name.trim() ||
            !displayName.trim() ||
            !validWhen ||
            !validSize
          }
        >
          <Plus size={16} aria-hidden="true" />
          {busy ? "Creating your plan…" : "Create plan & invite friends"}
        </button>
      </div>
    </>
  );
}
