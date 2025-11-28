CREATE TABLE "workflow_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" integer NOT NULL,
	"version_number" integer NOT NULL,
	"graph" jsonb NOT NULL,
	"input_schema" jsonb,
	"output_schema" jsonb,
	"change_summary" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_versions_workflow_version" UNIQUE("workflow_id","version_number")
);
--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "workflow_version_id" uuid;--> statement-breakpoint
ALTER TABLE "workflows" ADD COLUMN "active_version_id" uuid;--> statement-breakpoint
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_workflow_versions_workflow" ON "workflow_versions" USING btree ("workflow_id");--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workflow_version_id_workflow_versions_id_fk" FOREIGN KEY ("workflow_version_id") REFERENCES "public"."workflow_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_workflow_runs_version" ON "workflow_runs" USING btree ("workflow_version_id");--> statement-breakpoint
CREATE INDEX "idx_workflows_active_version" ON "workflows" USING btree ("active_version_id");