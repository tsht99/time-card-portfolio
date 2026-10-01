CREATE TYPE "public"."user_role" AS ENUM('staff', 'admin');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('pending', 'active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."attendance_event_type" AS ENUM('AttendanceClockedIn', 'AttendanceClockedOut', 'WorkPeriodCorrected', 'ClockInTimeCorrected', 'ClockOutTimeCorrected', 'AttendanceCancelled');--> statement-breakpoint
CREATE TYPE "public"."work_period" AS ENUM('day', 'night');--> statement-breakpoint
CREATE TYPE "public"."hourly_wage_day_type" AS ENUM('sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'holiday');--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_current_state_projection_metadata" (
	"projection_name" text PRIMARY KEY NOT NULL,
	"is_ready" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_current_states" (
	"attendance_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"attendance_date" date NOT NULL,
	"work_period" "work_period" NOT NULL,
	"clock_in_at" timestamp with time zone NOT NULL,
	"clock_out_at" timestamp with time zone,
	"event_version" integer NOT NULL,
	"is_cancelled" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attendance_events" (
	"event_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attendance_id" uuid NOT NULL,
	"performed_by_user_id" uuid NOT NULL,
	"event_version" integer NOT NULL,
	"event_type" "attendance_event_type" NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_events_attendance_id_event_version_unique" UNIQUE("attendance_id","event_version")
);
--> statement-breakpoint
CREATE TABLE "hourly_wage_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"work_period" "work_period" NOT NULL,
	"day_type" "hourly_wage_day_type" NOT NULL,
	"hourly_wage" integer NOT NULL,
	"effective_from" date NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hourly_wage_rates_user_period_day_effective_unique" UNIQUE("user_id","work_period","day_type","effective_from"),
	CONSTRAINT "hourly_wage_rates_hourly_wage_range_check" CHECK ("hourly_wage_rates"."hourly_wage" >= 0 and "hourly_wage_rates"."hourly_wage" <= 99999),
	CONSTRAINT "hourly_wage_rates_version_positive_check" CHECK ("hourly_wage_rates"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"line_user_id" text NOT NULL,
	"display_name" text,
	"role" "user_role" DEFAULT 'staff' NOT NULL,
	"status" "user_status" DEFAULT 'pending' NOT NULL,
	CONSTRAINT "users_line_user_id_unique" UNIQUE("line_user_id"),
	CONSTRAINT "users_display_name_length_check" CHECK ("users"."display_name" is null or char_length("users"."display_name") between 1 and 100),
	CONSTRAINT "users_staff_active_inactive_display_name_required_check" CHECK ("users"."role" <> 'staff'::user_role or "users"."status" = 'pending'::user_status or "users"."display_name" is not null)
);
--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_current_states" ADD CONSTRAINT "attendance_current_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_performed_by_user_id_users_id_fk" FOREIGN KEY ("performed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hourly_wage_rates" ADD CONSTRAINT "hourly_wage_rates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_sessions_expires_at_idx" ON "auth_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "attendance_current_states_attendance_date_idx" ON "attendance_current_states" USING btree ("attendance_date");--> statement-breakpoint
CREATE INDEX "attendance_current_states_user_id_attendance_date_idx" ON "attendance_current_states" USING btree ("user_id","attendance_date");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_current_states_one_working_per_user_idx" ON "attendance_current_states" USING btree ("user_id") WHERE "attendance_current_states"."clock_out_at" is null and "attendance_current_states"."is_cancelled" = false;--> statement-breakpoint
CREATE INDEX "attendance_events_clocked_in_user_id_idx" ON "attendance_events" USING btree (("payload"->>'userId'),"attendance_id") WHERE "attendance_events"."event_type" = 'AttendanceClockedIn'::attendance_event_type;--> statement-breakpoint
CREATE UNIQUE INDEX "users_active_inactive_display_name_unique" ON "users" USING btree ("display_name") WHERE "users"."status" in ('active'::user_status, 'inactive'::user_status) and "users"."display_name" is not null;