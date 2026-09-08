import type { ExperienceDriver } from "./experience-state";

/** Fixture-only timing driver. Production adapters can replace this object. */
export function createDeterministicFixtureDriver(): ExperienceDriver {
  return {
    startEnhance(input, emit) {
      let completed = 0;
      const timer = window.setInterval(() => {
        completed += 1;
        if (input.failAtChunk === completed) {
          window.clearInterval(timer);
          emit({
            type: "PLAN_FAILED",
            projectId: input.projectId,
            generation: input.generation,
            jobId: input.jobId,
            message: "Deterministic fixture failure.",
          });
          return;
        }
        emit({
          type: "PLAN_PROGRESS",
          projectId: input.projectId,
          generation: input.generation,
          jobId: input.jobId,
          chunksCompleted: completed,
          chunksTotal: input.chunksTotal,
        });
        if (completed >= input.chunksTotal) {
          window.clearInterval(timer);
          emit({
            type: "PLAN_COMPLETE",
            projectId: input.projectId,
            generation: input.generation,
            jobId: input.jobId,
          });
        }
      }, 120);
      return () => window.clearInterval(timer);
    },
    startExport(input, emit) {
      const timer = window.setTimeout(() => {
        emit(
          input.fail
            ? {
                type: "EXPORT_FAILED",
                projectId: input.projectId,
                generation: input.generation,
                jobId: input.jobId,
                message: "Deterministic fixture failure.",
              }
            : {
                type: "EXPORT_COMPLETE",
                projectId: input.projectId,
                generation: input.generation,
                jobId: input.jobId,
              },
        );
      }, input.delayMs ?? 250);
      return () => window.clearTimeout(timer);
    },
  };
}
