CREATE TABLE "run_audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"workflow_id" integer NOT NULL,
	"action" text NOT NULL,
	"actor" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"node_id" text,
	"event_type" text NOT NULL,
	"payload" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_stream_chunks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"chunk_type" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"scheduled_for" timestamp NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"processed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "secrets" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "suspensions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"suspension_type" text NOT NULL,
	"resume_token" text,
	"approval_message" text,
	"approval_options" jsonb,
	"resume_after" timestamp,
	"execution_context" jsonb NOT NULL,
	"resumed_at" timestamp,
	"resumed_by" text,
	"resume_payload" jsonb,
	"created_at" timestamp DEFAULT now(),
	"expires_at" timestamp,
	CONSTRAINT "suspensions_resume_token_unique" UNIQUE("resume_token")
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_body" jsonb,
	"request_headers" jsonb,
	"source_ip" text,
	"response_status" integer NOT NULL,
	"response_body" jsonb,
	"run_id" uuid,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "workflow_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" integer,
	"snapshot_graph" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"trigger" text DEFAULT 'manual',
	"input_data" jsonb,
	"output_data" jsonb,
	"pinned" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"started_at" timestamp,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"graph" jsonb NOT NULL,
	"webhook_enabled" boolean DEFAULT false,
	"webhook_secret" text,
	"schedule_enabled" boolean DEFAULT false,
	"schedule_cron" text,
	"schedule_timezone" text DEFAULT 'UTC',
	"schedule_input_data" jsonb,
	"schedule_next_run" timestamp with time zone,
	"schedule_overlap_mode" text DEFAULT 'skip',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_id_workflow_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_stream_chunks" ADD CONSTRAINT "run_stream_chunks_run_id_workflow_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_jobs" ADD CONSTRAINT "scheduled_jobs_run_id_workflow_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suspensions" ADD CONSTRAINT "suspensions_run_id_workflow_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_run_id_workflow_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audit_log_run" ON "run_audit_log" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "idx_audit_log_workflow" ON "run_audit_log" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "idx_audit_log_action" ON "run_audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "idx_run_events_run_id" ON "run_events" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "idx_run_events_type" ON "run_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "idx_run_events_node_id" ON "run_events" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "idx_stream_chunks_run_node" ON "run_stream_chunks" USING btree ("run_id","node_id");--> statement-breakpoint
CREATE INDEX "idx_stream_chunks_order" ON "run_stream_chunks" USING btree ("run_id","node_id","chunk_index");--> statement-breakpoint
CREATE INDEX "idx_scheduled_jobs_due" ON "scheduled_jobs" USING btree ("scheduled_for");--> statement-breakpoint
CREATE INDEX "idx_suspensions_token" ON "suspensions" USING btree ("resume_token");--> statement-breakpoint
CREATE INDEX "idx_suspensions_expires" ON "suspensions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_webhook_deliveries_idempotency" ON "webhook_deliveries" USING btree ("workflow_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_webhook_deliveries_workflow" ON "webhook_deliveries" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "idx_workflow_runs_status" ON "workflow_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_workflow_runs_workflow_id" ON "workflow_runs" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "idx_workflow_runs_created" ON "workflow_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_workflows_schedule" ON "workflows" USING btree ("schedule_next_run");