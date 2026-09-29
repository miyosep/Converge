"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Plus } from "lucide-react";
import { CategoryPicker, RestaurantPicker } from "./restaurant-picker";
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
  permittedRestaurantIds: string[];
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
  permittedRestaurantIds,
  setPermittedRestaurantIds,
  busy,
  onCreate,
}: PlanBuilderProps) {
  const [planningStep, setPlanningStep] = useState<1 | 2>(1);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previousStep = useRef(planningStep);
  useEffect(() => {
    if (previousStep.current !== planningStep) {
      headingRef.current?.focus();
      previousStep.current = planningStep;
    }
  }, [planningStep]);
  const validSize = groupSizeSchema.safeParse(Number(sizeInput)).success;
  const validWhen =
    !!when &&
    Number.isFinite(new Date(when).getTime()) &&
    new Date(when).getTime() > Date.now();
  return (
    <>
      {" "}
      <ol className="builder-steps" aria-label="Create a plan">
        <li aria-current={planningStep === 1 ? "step" : undefined}>
          1 <span>The basics</span>
        </li>
        <li aria-current={planningStep === 2 ? "step" : undefined}>
          2 <span>Places to consider</span>
        </li>
      </ol>
      <h2 ref={headingRef} tabIndex={-1}>
        {planningStep === 1
          ? "What do you have in mind?"
          : "Give your group a few good options."}
      </h2>
      <div hidden={planningStep !== 1}>
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
        <p className="flow-note">
          Groups of {MIN_GROUP_MEMBERS}–{MAX_GROUP_MEMBERS} can collect
          preferences, compare places and experiences and approve a shared test
          payment. The Explore demo uses six participants.
        </p>
      </div>
      <div hidden={planningStep !== 2}>
        <div className="plan-recap">
          <strong>{name}</strong>
          <span>
            {sizeInput} people · {when.replace("T", " at ")}
          </span>
          <button className="text-button" onClick={() => setPlanningStep(1)}>
            Edit details
          </button>
        </div>
        <RestaurantPicker
          category={category}

          selected={permittedRestaurantIds}
          onChange={setPermittedRestaurantIds}
        />
        <div className="builder-actions">
          <button
            className="secondary"
            disabled={busy}
            onClick={() => setPlanningStep(1)}
          >
            Back
          </button>
          <button
            className="primary"
            onClick={onCreate}
            disabled={
              busy ||
              !name.trim() ||
              !displayName.trim() ||
              !validWhen ||
              !validSize ||
              permittedRestaurantIds.length === 0
            }
          >
            <Plus size={16} />{" "}
            {busy ? "Creating your plan…" : "Create plan & invite friends"}
          </button>
        </div>
      </div>
      {planningStep === 1 && (
        <div className="builder-actions">
          <span>You can share the invite after creating your plan.</span>
          <button
            className="primary"
            disabled={
              !name.trim() || !displayName.trim() || !validWhen || !validSize
            }
            onClick={() => setPlanningStep(2)}
          >
            Next: choose places <ArrowRight size={16} />
          </button>
        </div>
      )}
    </>
  );
}
