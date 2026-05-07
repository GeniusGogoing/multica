"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Download, FileText, HardDrive, Loader2 } from "lucide-react";
import type {
  AgentRuntime,
  RuntimeLocalSkillSummary,
  Skill,
} from "@multica/core/types";
import { useAuthStore } from "@multica/core/auth";
import { useWorkspaceId } from "@multica/core/hooks";
import {
  runtimeListOptions,
  runtimeLocalSkillsKeys,
  runtimeLocalSkillsOptions,
  resolveRuntimeLocalSkillImport,
} from "@multica/core/runtimes";
import {
  skillDetailOptions,
  workspaceKeys,
} from "@multica/core/workspace/queries";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import { Label } from "@multica/ui/components/ui/label";
import { Badge } from "@multica/ui/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@multica/ui/components/ui/select";
import { Skeleton } from "@multica/ui/components/ui/skeleton";
import { Textarea } from "@multica/ui/components/ui/textarea";
import { useScrollFade } from "@multica/ui/hooks/use-scroll-fade";
import { toast } from "sonner";

function runtimeLabel(runtime: AgentRuntime): string {
  return `${runtime.name} (${runtime.provider})`;
}

type SkillDraft = {
  name: string;
  description: string;
};

function defaultDraft(skill: RuntimeLocalSkillSummary): SkillDraft {
  return {
    name: skill.name,
    description: skill.description ?? "",
  };
}

// ---------------------------------------------------------------------------

// Skill row with inline-expanded name/description editor when selected
// ---------------------------------------------------------------------------

function SkillItem({
  skill,
  checked,
  active,
  onToggle,
  onActivate,
  name,
  description,
  onNameChange,
  onDescriptionChange,
}: {
  skill: RuntimeLocalSkillSummary;
  checked: boolean;
  active: boolean;
  onToggle: () => void;
  onActivate: () => void;
  name: string;
  description: string;
  onNameChange: (v: string) => void;
  onDescriptionChange: (v: string) => void;
}) {
  return (
    <div
      className={`overflow-hidden rounded-lg border transition-colors ${
        active
          ? "border-primary bg-primary/5"
          : checked
            ? "border-primary/40 bg-primary/5"
            : "hover:bg-accent/40"
      }`}
    >
      <div className="flex w-full items-start gap-3 px-4 py-3 text-left">
        <label
          className="mt-2 flex shrink-0 cursor-pointer items-center"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggle}
            aria-label={`Select ${skill.name}`}
            className="h-4 w-4 rounded border-muted-foreground/40 accent-primary"
          />
        </label>
        <button
          type="button"
          onClick={onActivate}
          className="flex min-w-0 flex-1 items-start gap-3 text-left"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
            <FileText className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">{skill.name}</span>
              <Badge variant="secondary">{skill.provider}</Badge>
            </div>
            {skill.description && (
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                {skill.description}
              </p>
            )}
            <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
              {skill.source_path}
            </p>
          </div>
        </button>
        <Badge variant="outline" className="shrink-0">
          {skill.file_count} file{skill.file_count === 1 ? "" : "s"}
        </Badge>
      </div>

      {active && checked && (
        <div className="space-y-2.5 border-t bg-card px-4 py-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              Workspace skill name
            </Label>
            <Input
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder={skill.name}
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              Description
            </Label>
            <Textarea
              value={description}
              onChange={(e) => onDescriptionChange(e.target.value)}
              placeholder="Optional — describe when an agent should use this skill."
              rows={2}
              className="resize-none text-sm"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel — three-section layout: sticky top / scrollable middle / sticky bottom

//
// Previously took an `active` prop to defer work inside a tabbed parent; the
// parent now unmounts the panel when it's not the active method, so `active`
// is always implicitly true here.
// ---------------------------------------------------------------------------

export function RuntimeLocalSkillImportPanel({
  onImported,
}: {
  onImported?: (skill: Skill) => void;
}) {
  const wsId = useWorkspaceId();
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id ?? null);

  const { data: runtimes = [] } = useQuery(runtimeListOptions(wsId));
  // Only the runtime owner can browse + import local skills (server-side ACL).
  const localRuntimes = useMemo(
    () =>
      runtimes.filter(
        (r) =>
          r.runtime_mode === "local" &&
          (userId == null || r.owner_id === userId),
      ),
    [runtimes, userId],
  );

  const [selectedRuntimeId, setSelectedRuntimeId] = useState<string>("");
  const [selectedSkillKeys, setSelectedSkillKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [activeSkillKey, setActiveSkillKey] = useState<string>("");
  const [drafts, setDrafts] = useState<Record<string, SkillDraft>>({});
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

  // Default to the first local runtime once the list lands.
  useEffect(() => {
    setSelectedRuntimeId((prev) => prev || localRuntimes[0]?.id || "");
  }, [localRuntimes]);

  // Switching runtimes: clear stale selections immediately so old highlights
  // don't flash during the next scan window. The auto-seed effect below picks
  // the first discovered skill once the new runtime's inventory lands.
  useEffect(() => {
    setSelectedSkillKeys(new Set());
    setActiveSkillKey("");
    setDrafts({});
    setImportProgress(null);
  }, [selectedRuntimeId]);

  const selectedRuntime = localRuntimes.find((r) => r.id === selectedRuntimeId);
  const canBrowseSkills =
    !!selectedRuntimeId && selectedRuntime?.status === "online";
  const skillsQuery = useQuery({
    ...runtimeLocalSkillsOptions(selectedRuntimeId || null),
    enabled: canBrowseSkills,
  });
  const runtimeSkills = useMemo(
    () => skillsQuery.data?.skills ?? [],
    [skillsQuery.data],
  );

  // After a scan, keep any still-valid selections and default to the first
  // discovered skill so single-import remains one-click while allowing users
  // to expand the selection for batch import.
  useEffect(() => {
    if (runtimeSkills.length === 0) {
      setSelectedSkillKeys(new Set());
      setActiveSkillKey("");
      setDrafts({});
      return;
    }

    const availableKeys = new Set(runtimeSkills.map((s) => s.key));
    const first = runtimeSkills[0]!;

    setSelectedSkillKeys((prev) => {
      const next = new Set([...prev].filter((key) => availableKeys.has(key)));
      if (next.size === 0) next.add(first.key);
      return next;
    });
    setActiveSkillKey((prev) => (availableKeys.has(prev) ? prev : first.key));
    setDrafts((prev) => {
      const next: Record<string, SkillDraft> = {};
      for (const skill of runtimeSkills) {
        next[skill.key] = prev[skill.key] ?? defaultDraft(skill);
      }
      return next;
    });
  }, [runtimeSkills]);

  const selectedSkills = useMemo(
    () => runtimeSkills.filter((s) => selectedSkillKeys.has(s.key)),
    [runtimeSkills, selectedSkillKeys],
  );
  const selectedCount = selectedSkills.length;
  const allSelected =
    runtimeSkills.length > 0 && runtimeSkills.every((s) => selectedSkillKeys.has(s.key));

  const updateDraft = (
    skill: RuntimeLocalSkillSummary,
    patch: Partial<SkillDraft>,
  ) => {
    setDrafts((prev) => ({
      ...prev,
      [skill.key]: {
        ...(prev[skill.key] ?? defaultDraft(skill)),
        ...patch,
      },
    }));
  };

  const handleRowActivate = (skill: RuntimeLocalSkillSummary) => {
    setActiveSkillKey(skill.key);
    if (!selectedSkillKeys.has(skill.key)) {
      setSelectedSkillKeys((prev) => new Set(prev).add(skill.key));
    }
    if (!drafts[skill.key]) {
      updateDraft(skill, {});
    }
  };

  const handleToggleSkill = (skill: RuntimeLocalSkillSummary) => {
    const next = new Set(selectedSkillKeys);
    if (next.has(skill.key)) {
      next.delete(skill.key);
      if (activeSkillKey === skill.key) {
        const replacement = runtimeSkills.find((s) => next.has(s.key));
        setActiveSkillKey(replacement?.key ?? "");
      }
    } else {
      next.add(skill.key);
      setActiveSkillKey(skill.key);
      if (!drafts[skill.key]) {
        updateDraft(skill, {});
      }
    }
    setSelectedSkillKeys(next);
  };

  const handleSelectAll = () => {
    setSelectedSkillKeys(new Set(runtimeSkills.map((s) => s.key)));
    setActiveSkillKey((prev) => prev || runtimeSkills[0]?.key || "");
  };

  const handleClearSelection = () => {
    setSelectedSkillKeys(new Set());
    setActiveSkillKey("");
  };

  const handleImport = async () => {
    if (!selectedRuntimeId || selectedSkills.length === 0) return;
    const targets = selectedSkills.map((skill) => ({
      skill,
      draft: drafts[skill.key] ?? defaultDraft(skill),
    }));
    setImporting(true);
    setImportProgress({ done: 0, total: targets.length });

    const imported: Skill[] = [];
    const failedKeys = new Set<string>();
    const failures: string[] = [];

    try {
      for (const { skill, draft } of targets) {
        try {
          const result = await resolveRuntimeLocalSkillImport(selectedRuntimeId, {
            skill_key: skill.key,
            name: draft.name.trim() || undefined,
            description: draft.description.trim() || undefined,
          });
          imported.push(result.skill);
          qc.setQueryData(
            skillDetailOptions(wsId, result.skill.id).queryKey,
            result.skill,
          );
        } catch (error) {
          failedKeys.add(skill.key);
          failures.push(
            `${skill.name}: ${
              error instanceof Error ? error.message : "Failed to import skill"
            }`,
          );
        } finally {
          setImportProgress({
            done: imported.length + failures.length,
            total: targets.length,
          });
        }
      }

      await Promise.all([
        qc.invalidateQueries({
          queryKey: runtimeLocalSkillsKeys.forRuntime(selectedRuntimeId),
        }),
        qc.invalidateQueries({ queryKey: workspaceKeys.skills(wsId) }),
        qc.invalidateQueries({ queryKey: workspaceKeys.agents(wsId) }),
      ]);

      if (failures.length === 0) {
        toast.success(
          `${imported.length} skill${imported.length === 1 ? "" : "s"} imported`,
        );
        if (imported[0]) onImported?.(imported[0]);
      } else {
        setSelectedSkillKeys(failedKeys);
        setActiveSkillKey(failedKeys.values().next().value ?? "");
        toast.error(
          `${imported.length} imported, ${failures.length} failed. ${failures[0]}`,
        );
      }
    } finally {
      setImporting(false);
      setImportProgress(null);
    }
  };

  const hasInvalidSelection = selectedSkills.some((skill) => {
    const draft = drafts[skill.key] ?? defaultDraft(skill);
    return !draft.name.trim();
  });
  const canImport =
    !!selectedRuntime &&
    selectedRuntime.status === "online" &&
    selectedCount > 0 &&
    !hasInvalidSelection &&
    !importing;

  // --- Scroll fade for the middle region ---

  const scrollRef = useRef<HTMLDivElement>(null);
  const fadeStyle = useScrollFade(scrollRef);

  // --- Middle body — depends on discovery state ---
  const middle = (() => {
    if (localRuntimes.length === 0) {
      return (
        <div className="rounded-lg border border-dashed px-4 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            No local runtimes available
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Connect a local runtime to browse and import its local skills.
          </p>
        </div>
      );
    }
    if (!selectedRuntime) {
      return (
        <div className="rounded-lg border border-dashed px-4 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            Choose a runtime to continue
          </p>
        </div>
      );
    }
    if (selectedRuntime.status !== "online") {
      return (
        <div className="flex items-start gap-2 rounded-md bg-warning/10 px-3 py-2 text-xs text-muted-foreground">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          Runtime must be online to browse local skills.
        </div>
      );
    }
    if (skillsQuery.isLoading) {
      return (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-lg border px-4 py-3">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="mt-2 h-3 w-48" />
            </div>
          ))}
        </div>
      );
    }
    if (skillsQuery.error) {
      return (
        <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {skillsQuery.error instanceof Error
            ? skillsQuery.error.message
            : "Failed to load runtime local skills"}
        </div>
      );
    }
    if (!skillsQuery.data?.supported) {
      return (
        <div className="flex items-start gap-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          This runtime provider does not expose local skill inventory yet.
        </div>
      );
    }
    if (runtimeSkills.length === 0) {
      return (
        <div className="rounded-lg border border-dashed px-4 py-10 text-center">
          <p className="text-sm text-muted-foreground">No local skills found</p>
          <p className="mt-1 text-xs text-muted-foreground">
            This runtime does not have any discoverable local skills yet.
          </p>
        </div>
      );
    }
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          <span>
            {selectedCount} of {runtimeSkills.length} selected
          </span>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={handleSelectAll}
              disabled={allSelected || importing}
            >
              Select all
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={handleClearSelection}
              disabled={selectedCount === 0 || importing}
            >
              Clear
            </Button>
          </div>
        </div>
        {runtimeSkills.map((s) => {
          const draft = drafts[s.key] ?? defaultDraft(s);
          return (
            <SkillItem
              key={s.key}
              skill={s}
              checked={selectedSkillKeys.has(s.key)}
              active={activeSkillKey === s.key}
              onToggle={() => handleToggleSkill(s)}
              onActivate={() => handleRowActivate(s)}
              name={draft.name}
              description={draft.description}
              onNameChange={(value) => updateDraft(s, { name: value })}
              onDescriptionChange={(value) =>
                updateDraft(s, { description: value })
              }
            />
          );
        })}
      </div>
    );

  })();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Sticky top: runtime picker + status */}
      <div
        // While importing, lock the whole runtime/skill selection so the user
        // can't switch targets out from under the in-flight request.
        aria-disabled={importing || undefined}
        className={`shrink-0 space-y-2 border-b px-5 py-3 ${
          importing ? "pointer-events-none opacity-60" : ""
        }`}
      >
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Runtime</Label>
          <Select
            value={selectedRuntimeId}
            onValueChange={(v) => v && setSelectedRuntimeId(v)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a local runtime">
                {selectedRuntime ? runtimeLabel(selectedRuntime) : null}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {localRuntimes.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {runtimeLabel(r)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selectedRuntime && (
          <div className="flex items-center gap-2 rounded-md border bg-muted/20 px-3 py-1.5 text-xs text-muted-foreground">
            <HardDrive className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              {runtimeLabel(selectedRuntime)}
            </span>
            <Badge
              variant={
                selectedRuntime.status === "online" ? "secondary" : "outline"
              }
            >
              {selectedRuntime.status}
            </Badge>
          </div>
        )}
      </div>

      {/* Scrollable middle — also locked during import. */}
      <div
        ref={scrollRef}
        style={fadeStyle}
        aria-disabled={importing || undefined}
        className={`flex-1 min-h-0 overflow-y-auto px-5 py-3 ${
          importing ? "pointer-events-none opacity-60" : ""
        }`}
      >
        {middle}
        <p className="mt-3 text-xs text-muted-foreground">
          Symlinks, unreadable files, oversized files, and very large bundles
          are ignored during import.
        </p>
      </div>

      {/* Sticky bottom: Import button + context */}
      <div className="flex shrink-0 items-center gap-3 border-t bg-muted/30 px-5 py-3">
        <div className="min-w-0 flex-1 text-xs text-muted-foreground">
          {importProgress ? (
            <>
              Importing {importProgress.done} of {importProgress.total} selected
              skills…
            </>
          ) : selectedCount > 0 ? (
            <>
              Ready to import{" "}
              <span className="font-medium text-foreground">
                {selectedCount} selected skill{selectedCount === 1 ? "" : "s"}
              </span>{" "}
              into this workspace.
            </>
          ) : (
            "Select one or more skills to continue."
          )}
        </div>
        <Button
          type="button"
          size="sm"
          onClick={handleImport}
          disabled={!canImport}
        >
          {importing ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              Importing…
            </>
          ) : (
            <>
              <Download className="h-3 w-3" />
              Import to Workspace
            </>
          )}
        </Button>
      </div>
    </div>

  );
}
