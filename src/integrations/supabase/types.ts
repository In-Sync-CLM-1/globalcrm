export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      activity_participants: {
        Row: {
          activity_id: string
          contact_id: string | null
          created_at: string | null
          email: string
          id: string
          name: string
          org_id: string
          response_status: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          activity_id: string
          contact_id?: string | null
          created_at?: string | null
          email: string
          id?: string
          name: string
          org_id: string
          response_status?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          activity_id?: string
          contact_id?: string | null
          created_at?: string | null
          email?: string
          id?: string
          name?: string
          org_id?: string
          response_status?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_participants_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "contact_activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_participants_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_participants_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_with_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_participants_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_call_sessions: {
        Row: {
          agent_id: string
          contact_id: string | null
          ended_at: string | null
          exotel_call_sid: string | null
          id: string
          org_id: string
          started_at: string | null
          status: string
        }
        Insert: {
          agent_id: string
          contact_id?: string | null
          ended_at?: string | null
          exotel_call_sid?: string | null
          id?: string
          org_id: string
          started_at?: string | null
          status?: string
        }
        Update: {
          agent_id?: string
          contact_id?: string | null
          ended_at?: string | null
          exotel_call_sid?: string | null
          id?: string
          org_id?: string
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_call_sessions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_call_sessions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_with_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_call_sessions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_coaching_plans: {
        Row: {
          agent_id: string
          avg_quality_score: number | null
          calls_analyzed: number
          dominant_tone: string | null
          drills: Json | null
          generated_at: string
          generation_error: string | null
          id: string
          org_id: string
          role_play_scenarios: Json | null
          strengths: Json | null
          top_objections: Json | null
          weaknesses: Json | null
        }
        Insert: {
          agent_id: string
          avg_quality_score?: number | null
          calls_analyzed: number
          dominant_tone?: string | null
          drills?: Json | null
          generated_at?: string
          generation_error?: string | null
          id?: string
          org_id: string
          role_play_scenarios?: Json | null
          strengths?: Json | null
          top_objections?: Json | null
          weaknesses?: Json | null
        }
        Update: {
          agent_id?: string
          avg_quality_score?: number | null
          calls_analyzed?: number
          dominant_tone?: string | null
          drills?: Json | null
          generated_at?: string
          generation_error?: string | null
          id?: string
          org_id?: string
          role_play_scenarios?: Json | null
          strengths?: Json | null
          top_objections?: Json | null
          weaknesses?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_coaching_plans_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_coaching_plans_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_call_scripts: {
        Row: {
          behavioral_guidelines: string | null
          bolna_agent_id: string | null
          closing: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          key_points: Json
          language: string | null
          max_duration_seconds: number | null
          name: string
          objection_handling: Json
          objective: string
          opening: string
          org_id: string
          owner_id: string | null
          product_name: string | null
          product_notes: string | null
          updated_at: string | null
          voice_id: string | null
          voice_name: string | null
        }
        Insert: {
          behavioral_guidelines?: string | null
          bolna_agent_id?: string | null
          closing?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          key_points?: Json
          language?: string | null
          max_duration_seconds?: number | null
          name: string
          objection_handling?: Json
          objective: string
          opening: string
          org_id: string
          owner_id?: string | null
          product_name?: string | null
          product_notes?: string | null
          updated_at?: string | null
          voice_id?: string | null
          voice_name?: string | null
        }
        Update: {
          behavioral_guidelines?: string | null
          bolna_agent_id?: string | null
          closing?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          key_points?: Json
          language?: string | null
          max_duration_seconds?: number | null
          name?: string
          objection_handling?: Json
          objective?: string
          opening?: string
          org_id?: string
          owner_id?: string | null
          product_name?: string | null
          product_notes?: string | null
          updated_at?: string | null
          voice_id?: string | null
          voice_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_call_scripts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_call_scripts_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_daily_insights: {
        Row: {
          call_count: number
          completed_count: number
          for_date: string
          generated_at: string
          id: string
          insights: Json
          org_id: string
          product: string
        }
        Insert: {
          call_count?: number
          completed_count?: number
          for_date: string
          generated_at?: string
          id?: string
          insights: Json
          org_id: string
          product?: string
        }
        Update: {
          call_count?: number
          completed_count?: number
          for_date?: string
          generated_at?: string
          id?: string
          insights?: Json
          org_id?: string
          product?: string
        }
        Relationships: []
      }
      ai_outcome_disposition_map: {
        Row: {
          created_at: string | null
          disposition_id: string
          id: string
          org_id: string
          outcome_key: string
          sets_opt_out: boolean
        }
        Insert: {
          created_at?: string | null
          disposition_id: string
          id?: string
          org_id: string
          outcome_key: string
          sets_opt_out?: boolean
        }
        Update: {
          created_at?: string | null
          disposition_id?: string
          id?: string
          org_id?: string
          outcome_key?: string
          sets_opt_out?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "ai_outcome_disposition_map_disposition_id_fkey"
            columns: ["disposition_id"]
            isOneToOne: false
            referencedRelation: "call_dispositions"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_script_proposals: {
        Row: {
          based_on_date: string
          generated_at: string
          id: string
          org_id: string
          proposed_behavioral_guidelines: string | null
          proposed_closing: string | null
          proposed_key_points: string[] | null
          proposed_objection_handling: Json | null
          proposed_objective: string | null
          proposed_opening: string | null
          rationale: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          script_id: string
          status: string
        }
        Insert: {
          based_on_date: string
          generated_at?: string
          id?: string
          org_id: string
          proposed_behavioral_guidelines?: string | null
          proposed_closing?: string | null
          proposed_key_points?: string[] | null
          proposed_objection_handling?: Json | null
          proposed_objective?: string | null
          proposed_opening?: string | null
          rationale?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          script_id: string
          status?: string
        }
        Update: {
          based_on_date?: string
          generated_at?: string
          id?: string
          org_id?: string
          proposed_behavioral_guidelines?: string | null
          proposed_closing?: string | null
          proposed_key_points?: string[] | null
          proposed_objection_handling?: Json | null
          proposed_objective?: string | null
          proposed_opening?: string | null
          rationale?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          script_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_script_proposals_script_id_fkey"
            columns: ["script_id"]
            isOneToOne: false
            referencedRelation: "ai_call_scripts"
            referencedColumns: ["id"]
          },
        ]
      }
      api_key_usage_logs: {
        Row: {
          api_key_id: string
          created_at: string
          endpoint: string
          error_message: string | null
          id: string
          ip_address: unknown
          method: string
          org_id: string
          response_time_ms: number | null
          status_code: number
          user_agent: string | null
        }
        Insert: {
          api_key_id: string
          created_at?: string
          endpoint: string
          error_message?: string | null
          id?: string
          ip_address?: unknown
          method: string
          org_id: string
          response_time_ms?: number | null
          status_code: number
          user_agent?: string | null
        }
        Update: {
          api_key_id?: string
          created_at?: string
          endpoint?: string
          error_message?: string | null
          id?: string
          ip_address?: unknown
          method?: string
          org_id?: string
          response_time_ms?: number | null
          status_code?: number
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "api_key_usage_logs_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_key_usage_logs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          api_key: string
          created_at: string
          created_by: string
          expires_at: string | null
          id: string
          is_active: boolean
          key_name: string
          key_prefix: string
          last_used_at: string | null
          org_id: string
          permissions: Json
          updated_at: string
        }
        Insert: {
          api_key: string
          created_at?: string
          created_by: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          key_name: string
          key_prefix: string
          last_used_at?: string | null
          org_id: string
          permissions?: Json
          updated_at?: string
        }
        Update: {
          api_key?: string
          created_at?: string
          created_by?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          key_name?: string
          key_prefix?: string
          last_used_at?: string | null
          org_id?: string
          permissions?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_rules: {
        Row: {
          approval_type_id: string
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          org_id: string
          required_roles: string[]
          threshold_amount: number | null
          updated_at: string
        }
        Insert: {
          approval_type_id: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          org_id: string
          required_roles?: string[]
          threshold_amount?: number | null
          updated_at?: string
        }
        Update: {
          approval_type_id?: string
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          org_id?: string
          required_roles?: string[]
          threshold_amount?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_rules_approval_type_id_fkey"
            columns: ["approval_type_id"]
            isOneToOne: false
            referencedRelation: "approval_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_rules_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_tokens: {
        Row: {
          action: string
          approver_id: string
          created_at: string | null
          expires_at: string
          id: string
          org_id: string
          request_id: string
          request_type: string
          token: string
          used_at: string | null
        }
        Insert: {
          action: string
          approver_id: string
          created_at?: string | null
          expires_at?: string
          id?: string
          org_id: string
          request_id: string
          request_type: string
          token?: string
          used_at?: string | null
        }
        Update: {
          action?: string
          approver_id?: string
          created_at?: string | null
          expires_at?: string
          id?: string
          org_id?: string
          request_id?: string
          request_type?: string
          token?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "approval_tokens_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_types: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          org_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          org_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_types_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_policies: {
        Row: {
          created_at: string | null
          grace_period_minutes: number | null
          half_day_threshold_hours: number | null
          id: string
          is_active: boolean | null
          org_id: string
          overtime_start_after_hours: number | null
          policy_name: string
          updated_at: string | null
          working_hours_per_day: number | null
        }
        Insert: {
          created_at?: string | null
          grace_period_minutes?: number | null
          half_day_threshold_hours?: number | null
          id?: string
          is_active?: boolean | null
          org_id: string
          overtime_start_after_hours?: number | null
          policy_name?: string
          updated_at?: string | null
          working_hours_per_day?: number | null
        }
        Update: {
          created_at?: string | null
          grace_period_minutes?: number | null
          half_day_threshold_hours?: number | null
          id?: string
          is_active?: boolean | null
          org_id?: string
          overtime_start_after_hours?: number | null
          policy_name?: string
          updated_at?: string | null
          working_hours_per_day?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "attendance_policies_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_records: {
        Row: {
          created_at: string | null
          date: string
          id: string
          location_lat: number | null
          location_lng: number | null
          network_status: string | null
          notes: string | null
          org_id: string
          sign_in_device_info: Json | null
          sign_in_location_accuracy: number | null
          sign_in_location_city: string | null
          sign_in_location_state: string | null
          sign_in_photo_url: string | null
          sign_in_time: string | null
          sign_out_device_info: Json | null
          sign_out_location_accuracy: number | null
          sign_out_location_city: string | null
          sign_out_location_state: string | null
          sign_out_photo_url: string | null
          sign_out_time: string | null
          status: string
          sync_status: string | null
          total_hours: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          date: string
          id?: string
          location_lat?: number | null
          location_lng?: number | null
          network_status?: string | null
          notes?: string | null
          org_id: string
          sign_in_device_info?: Json | null
          sign_in_location_accuracy?: number | null
          sign_in_location_city?: string | null
          sign_in_location_state?: string | null
          sign_in_photo_url?: string | null
          sign_in_time?: string | null
          sign_out_device_info?: Json | null
          sign_out_location_accuracy?: number | null
          sign_out_location_city?: string | null
          sign_out_location_state?: string | null
          sign_out_photo_url?: string | null
          sign_out_time?: string | null
          status?: string
          sync_status?: string | null
          total_hours?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          date?: string
          id?: string
          location_lat?: number | null
          location_lng?: number | null
          network_status?: string | null
          notes?: string | null
          org_id?: string
          sign_in_device_info?: Json | null
          sign_in_location_accuracy?: number | null
          sign_in_location_city?: string | null
          sign_in_location_state?: string | null
          sign_in_photo_url?: string | null
          sign_in_time?: string | null
          sign_out_device_info?: Json | null
          sign_out_location_accuracy?: number | null
          sign_out_location_city?: string | null
          sign_out_location_state?: string | null
          sign_out_photo_url?: string | null
          sign_out_time?: string | null
          status?: string
          sync_status?: string | null
          total_hours?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_records_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      attendance_regularizations: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          attendance_date: string
          created_at: string
          id: string
          org_id: string
          original_sign_in_time: string | null
          original_sign_out_time: string | null
          reason: string
          regularization_type: Database["public"]["Enums"]["regularization_type"]
          rejection_reason: string | null
          requested_sign_in_time: string | null
          requested_sign_out_time: string | null
          status: Database["public"]["Enums"]["regularization_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          attendance_date: string
          created_at?: string
          id?: string
          org_id: string
          original_sign_in_time?: string | null
          original_sign_out_time?: string | null
          reason: string
          regularization_type: Database["public"]["Enums"]["regularization_type"]
          rejection_reason?: string | null
          requested_sign_in_time?: string | null
          requested_sign_out_time?: string | null
          status?: Database["public"]["Enums"]["regularization_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          attendance_date?: string
          created_at?: string
          id?: string
          org_id?: string
          original_sign_in_time?: string | null
          original_sign_out_time?: string | null
          reason?: string
          regularization_type?: Database["public"]["Enums"]["regularization_type"]
          rejection_reason?: string | null
          requested_sign_in_time?: string | null
          requested_sign_out_time?: string | null
          status?: Database["public"]["Enums"]["regularization_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_regularizations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_ab_tests: {
        Row: {
          created_at: string
          end_date: string | null
          id: string
          org_id: string
          rule_id: string
          start_date: string
          status: string
          test_name: string
          updated_at: string
          variants: Json
          winner_variant: string | null
        }
        Insert: {
          created_at?: string
          end_date?: string | null
          id?: string
          org_id: string
          rule_id: string
          start_date?: string
          status?: string
          test_name: string
          updated_at?: string
          variants: Json
          winner_variant?: string | null
        }
        Update: {
          created_at?: string
          end_date?: string | null
          id?: string
          org_id?: string
          rule_id?: string
          start_date?: string
          status?: string
          test_name?: string
          updated_at?: string
          variants?: Json
          winner_variant?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "automation_ab_tests_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_ab_tests_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "email_automation_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_approvals: {
        Row: {
          approval_notes: string | null
          execution_id: string
          expires_at: string | null
          id: string
          org_id: string
          rejection_reason: string | null
          requested_at: string
          requested_by: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          rule_id: string
          status: string
        }
        Insert: {
          approval_notes?: string | null
          execution_id: string
          expires_at?: string | null
          id?: string
          org_id: string
          rejection_reason?: string | null
          requested_at?: string
          requested_by?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          rule_id: string
          status?: string
        }
        Update: {
          approval_notes?: string | null
          execution_id?: string
          expires_at?: string | null
          id?: string
          org_id?: string
          rejection_reason?: string | null
          requested_at?: string
          requested_by?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          rule_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_approvals_execution_id_fkey"
            columns: ["execution_id"]
            isOneToOne: true
            referencedRelation: "email_automation_executions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_approvals_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_approvals_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "email_automation_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_performance_daily: {
        Row: {
          avg_time_to_click_minutes: number | null
          avg_time_to_convert_minutes: number | null
          avg_time_to_open_minutes: number | null
          created_at: string
          id: string
          org_id: string
          report_date: string
          rule_id: string | null
          total_clicked: number | null
          total_conversion_value: number | null
          total_converted: number | null
          total_failed: number | null
          total_opened: number | null
          total_sent: number | null
          total_triggered: number | null
          unique_clicks: number | null
          unique_opens: number | null
        }
        Insert: {
          avg_time_to_click_minutes?: number | null
          avg_time_to_convert_minutes?: number | null
          avg_time_to_open_minutes?: number | null
          created_at?: string
          id?: string
          org_id: string
          report_date: string
          rule_id?: string | null
          total_clicked?: number | null
          total_conversion_value?: number | null
          total_converted?: number | null
          total_failed?: number | null
          total_opened?: number | null
          total_sent?: number | null
          total_triggered?: number | null
          unique_clicks?: number | null
          unique_opens?: number | null
        }
        Update: {
          avg_time_to_click_minutes?: number | null
          avg_time_to_convert_minutes?: number | null
          avg_time_to_open_minutes?: number | null
          created_at?: string
          id?: string
          org_id?: string
          report_date?: string
          rule_id?: string | null
          total_clicked?: number | null
          total_conversion_value?: number | null
          total_converted?: number | null
          total_failed?: number | null
          total_opened?: number | null
          total_sent?: number | null
          total_triggered?: number | null
          unique_clicks?: number | null
          unique_opens?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "automation_performance_daily_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_performance_daily_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "email_automation_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      blog_posts: {
        Row: {
          blog_excerpt: string | null
          blog_title: string
          blog_url: string
          campaign_id: string | null
          created_at: string
          email_campaign_sent: boolean
          email_recipients_count: number | null
          error_message: string | null
          facebook_url: string | null
          featured_image_url: string | null
          id: string
          linkedin_url: string | null
          org_id: string
          posted_timestamp: string
          publish_date: string
          social_posted: boolean
          status: string
          twitter_url: string | null
          updated_at: string
        }
        Insert: {
          blog_excerpt?: string | null
          blog_title: string
          blog_url: string
          campaign_id?: string | null
          created_at?: string
          email_campaign_sent?: boolean
          email_recipients_count?: number | null
          error_message?: string | null
          facebook_url?: string | null
          featured_image_url?: string | null
          id?: string
          linkedin_url?: string | null
          org_id: string
          posted_timestamp?: string
          publish_date: string
          social_posted?: boolean
          status?: string
          twitter_url?: string | null
          updated_at?: string
        }
        Update: {
          blog_excerpt?: string | null
          blog_title?: string
          blog_url?: string
          campaign_id?: string | null
          created_at?: string
          email_campaign_sent?: boolean
          email_recipients_count?: number | null
          error_message?: string | null
          facebook_url?: string | null
          featured_image_url?: string | null
          id?: string
          linkedin_url?: string | null
          org_id?: string
          posted_timestamp?: string
          publish_date?: string
          social_posted?: boolean
          status?: string
          twitter_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "blog_posts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      bulk_import_history: {
        Row: {
          can_revert: boolean | null
          cancelled_at: string | null
          completed_at: string | null
          created_at: string | null
          current_batch: number | null
          error_log: Json | null
          failed_records: number | null
          file_name: string
          id: string
          org_id: string
          processed_records: number | null
          reverted_at: string | null
          status: Database["public"]["Enums"]["import_status"] | null
          successful_records: number | null
          table_name: string
          total_batches: number
          total_records: number
          updated_at: string | null
          user_id: string
        }
        Insert: {
          can_revert?: boolean | null
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string | null
          current_batch?: number | null
          error_log?: Json | null
          failed_records?: number | null
          file_name: string
          id?: string
          org_id: string
          processed_records?: number | null
          reverted_at?: string | null
          status?: Database["public"]["Enums"]["import_status"] | null
          successful_records?: number | null
          table_name: string
          total_batches: number
          total_records: number
          updated_at?: string | null
          user_id: string
        }
        Update: {
          can_revert?: boolean | null
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string | null
          current_batch?: number | null
          error_log?: Json | null
          failed_records?: number | null
          file_name?: string
          id?: string
          org_id?: string
          processed_records?: number | null
          reverted_at?: string | null
          status?: Database["public"]["Enums"]["import_status"] | null
          successful_records?: number | null
          table_name?: string
          total_batches?: number
          total_records?: number
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bulk_import_history_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      bulk_import_records: {
        Row: {
          created_at: string | null
          id: string
          import_id: string
          record_id: string
          row_number: number
          table_name: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          import_id: string
          record_id: string
          row_number: number
          table_name: string
        }
        Update: {
          created_at?: string | null
          id?: string
          import_id?: string
          record_id?: string
          row_number?: number
          table_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "bulk_import_records_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "bulk_import_history"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_shares: {
        Row: {
          created_at: string | null
          id: string
          org_id: string
          owner_id: string
          permission: string
          shared_with_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          org_id: string
          owner_id: string
          permission?: string
          shared_with_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          org_id?: string
          owner_id?: string
          permission?: string
          shared_with_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calendar_shares_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      call_dispositions: {
        Row: {
          category: string | null
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          org_id: string
          updated_at: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          org_id: string
          updated_at?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          org_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "call_dispositions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      call_logs: {
        Row: {
          activity_id: string | null
          agent_id: string | null
          ai_script_id: string | null
          analysis_error: string | null
          analysis_next_step: string | null
          analysis_objections: Json | null
          analysis_quality_score: number | null
          analysis_script_adherence: string | null
          analysis_status: string | null
          analysis_summary: string | null
          analysis_tone: string | null
          analyzed_at: string | null
          answered_at: string | null
          bolna_batch_id: string | null
          bolna_execution_id: string | null
          bolna_queue_position: number | null
          call_duration: number | null
          call_type: string
          caller_type: string
          contact_id: string | null
          conversation_duration: number | null
          created_at: string | null
          customer_message_sent_at: string | null
          direction: string
          disposition_id: string | null
          ended_at: string | null
          exotel_call_sid: string | null
          exotel_conversation_uuid: string | null
          exotel_raw_data: Json | null
          extracted_data: Json | null
          from_number: string
          id: string
          notes: string | null
          org_id: string
          r2_key: string | null
          r2_upload_error: string | null
          r2_uploaded_at: string | null
          recording_duration: number | null
          recording_url: string | null
          ring_duration: number | null
          started_at: string | null
          status: string
          sub_disposition_id: string | null
          to_number: string
          transcribed_at: string | null
          transcript: string | null
          transcript_error: string | null
          transcript_status: string | null
        }
        Insert: {
          activity_id?: string | null
          agent_id?: string | null
          ai_script_id?: string | null
          analysis_error?: string | null
          analysis_next_step?: string | null
          analysis_objections?: Json | null
          analysis_quality_score?: number | null
          analysis_script_adherence?: string | null
          analysis_status?: string | null
          analysis_summary?: string | null
          analysis_tone?: string | null
          analyzed_at?: string | null
          answered_at?: string | null
          bolna_batch_id?: string | null
          bolna_execution_id?: string | null
          bolna_queue_position?: number | null
          call_duration?: number | null
          call_type: string
          caller_type?: string
          contact_id?: string | null
          conversation_duration?: number | null
          created_at?: string | null
          customer_message_sent_at?: string | null
          direction: string
          disposition_id?: string | null
          ended_at?: string | null
          exotel_call_sid?: string | null
          exotel_conversation_uuid?: string | null
          exotel_raw_data?: Json | null
          extracted_data?: Json | null
          from_number: string
          id?: string
          notes?: string | null
          org_id: string
          r2_key?: string | null
          r2_upload_error?: string | null
          r2_uploaded_at?: string | null
          recording_duration?: number | null
          recording_url?: string | null
          ring_duration?: number | null
          started_at?: string | null
          status: string
          sub_disposition_id?: string | null
          to_number: string
          transcribed_at?: string | null
          transcript?: string | null
          transcript_error?: string | null
          transcript_status?: string | null
        }
        Update: {
          activity_id?: string | null
          agent_id?: string | null
          ai_script_id?: string | null
          analysis_error?: string | null
          analysis_next_step?: string | null
          analysis_objections?: Json | null
          analysis_quality_score?: number | null
          analysis_script_adherence?: string | null
          analysis_status?: string | null
          analysis_summary?: string | null
          analysis_tone?: string | null
          analyzed_at?: string | null
          answered_at?: string | null
          bolna_batch_id?: string | null
          bolna_execution_id?: string | null
          bolna_queue_position?: number | null
          call_duration?: number | null
          call_type?: string
          caller_type?: string
          contact_id?: string | null
          conversation_duration?: number | null
          created_at?: string | null
          customer_message_sent_at?: string | null
          direction?: string
          disposition_id?: string | null
          ended_at?: string | null
          exotel_call_sid?: string | null
          exotel_conversation_uuid?: string | null
          exotel_raw_data?: Json | null
          extracted_data?: Json | null
          from_number?: string
          id?: string
          notes?: string | null
          org_id?: string
          r2_key?: string | null
          r2_upload_error?: string | null
          r2_uploaded_at?: string | null
          recording_duration?: number | null
          recording_url?: string | null
          ring_duration?: number | null
          started_at?: string | null
          status?: string
          sub_disposition_id?: string | null
          to_number?: string
          transcribed_at?: string | null
          transcript?: string | null
          transcript_error?: string | null
          transcript_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "call_logs_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "contact_activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_logs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_logs_ai_script_id_fkey"
            columns: ["ai_script_id"]
            isOneToOne: false
            referencedRelation: "ai_call_scripts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_logs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_logs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_with_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_logs_disposition_id_fkey"
            columns: ["disposition_id"]
            isOneToOne: false
            referencedRelation: "call_dispositions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_logs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_logs_sub_disposition_id_fkey"
            columns: ["sub_disposition_id"]
            isOneToOne: false
            referencedRelation: "call_sub_dispositions"
            referencedColumns: ["id"]
          },
        ]
      }
      call_sub_dispositions: {
        Row: {
          created_at: string | null
          description: string | null
          disposition_id: string
          id: string
          is_active: boolean | null
          name: string
          org_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          disposition_id: string
          id?: string
          is_active?: boolean | null
          name: string
          org_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          disposition_id?: string
          id?: string
          is_active?: boolean | null
          name?: string
          org_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "call_sub_dispositions_disposition_id_fkey"
            columns: ["disposition_id"]
            isOneToOne: false
            referencedRelation: "call_dispositions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_sub_dispositions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_analytics: {
        Row: {
          bounce_count: number | null
          campaign_id: string
          campaign_type: string
          click_count: number | null
          conversions: number | null
          cpa: number | null
          created_at: string | null
          date: string
          id: string
          open_count: number | null
          org_id: string
          revenue: number | null
          roas: number | null
          spend: number | null
        }
        Insert: {
          bounce_count?: number | null
          campaign_id: string
          campaign_type: string
          click_count?: number | null
          conversions?: number | null
          cpa?: number | null
          created_at?: string | null
          date: string
          id?: string
          open_count?: number | null
          org_id: string
          revenue?: number | null
          roas?: number | null
          spend?: number | null
        }
        Update: {
          bounce_count?: number | null
          campaign_id?: string
          campaign_type?: string
          click_count?: number | null
          conversions?: number | null
          cpa?: number | null
          created_at?: string | null
          date?: string
          id?: string
          open_count?: number | null
          org_id?: string
          revenue?: number | null
          roas?: number | null
          spend?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_analytics_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_insights: {
        Row: {
          analysis: string | null
          campaign_id: string | null
          created_at: string | null
          description: string | null
          expires_at: string | null
          id: string
          impact: string | null
          insight_type: string
          org_id: string
          priority: string
          status: string | null
          suggested_action: string | null
          supporting_data: Json | null
          title: string
          updated_at: string | null
        }
        Insert: {
          analysis?: string | null
          campaign_id?: string | null
          created_at?: string | null
          description?: string | null
          expires_at?: string | null
          id?: string
          impact?: string | null
          insight_type: string
          org_id: string
          priority: string
          status?: string | null
          suggested_action?: string | null
          supporting_data?: Json | null
          title: string
          updated_at?: string | null
        }
        Update: {
          analysis?: string | null
          campaign_id?: string | null
          created_at?: string | null
          description?: string | null
          expires_at?: string | null
          id?: string
          impact?: string | null
          insight_type?: string
          org_id?: string
          priority?: string
          status?: string | null
          suggested_action?: string | null
          supporting_data?: Json | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_insights_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      carry_forward_snapshot: {
        Row: {
          captured_at: string | null
          created_at: string | null
          id: string
          org_id: string
          qualified_contact_ids: string[] | null
          reference_year: number
        }
        Insert: {
          captured_at?: string | null
          created_at?: string | null
          id?: string
          org_id: string
          qualified_contact_ids?: string[] | null
          reference_year?: number
        }
        Update: {
          captured_at?: string | null
          created_at?: string | null
          id?: string
          org_id?: string
          qualified_contact_ids?: string[] | null
          reference_year?: number
        }
        Relationships: [
          {
            foreignKeyName: "carry_forward_snapshot_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_conversations: {
        Row: {
          conversation_type: string
          created_at: string
          created_by: string | null
          id: string
          last_message_at: string | null
          name: string | null
          org_id: string
          updated_at: string
        }
        Insert: {
          conversation_type?: string
          created_at?: string
          created_by?: string | null
          id?: string
          last_message_at?: string | null
          name?: string | null
          org_id: string
          updated_at?: string
        }
        Update: {
          conversation_type?: string
          created_at?: string
          created_by?: string | null
          id?: string
          last_message_at?: string | null
          name?: string | null
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_conversations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_conversations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_message_reactions: {
        Row: {
          created_at: string
          emoji: string
          id: string
          message_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          id?: string
          message_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          id?: string
          message_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_message_reactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          content: string | null
          conversation_id: string
          created_at: string
          file_name: string | null
          file_size: number | null
          file_url: string | null
          id: string
          is_edited: boolean | null
          message_type: string
          sender_id: string
          task_id: string | null
          updated_at: string
        }
        Insert: {
          content?: string | null
          conversation_id: string
          created_at?: string
          file_name?: string | null
          file_size?: number | null
          file_url?: string | null
          id?: string
          is_edited?: boolean | null
          message_type?: string
          sender_id: string
          task_id?: string | null
          updated_at?: string
        }
        Update: {
          content?: string | null
          conversation_id?: string
          created_at?: string
          file_name?: string | null
          file_size?: number | null
          file_url?: string | null
          id?: string
          is_edited?: boolean | null
          message_type?: string
          sender_id?: string
          task_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_participants: {
        Row: {
          conversation_id: string
          id: string
          is_admin: boolean | null
          joined_at: string
          last_read_at: string | null
          user_id: string
        }
        Insert: {
          conversation_id: string
          id?: string
          is_admin?: boolean | null
          joined_at?: string
          last_read_at?: string | null
          user_id: string
        }
        Update: {
          conversation_id?: string
          id?: string
          is_admin?: boolean | null
          joined_at?: string
          last_read_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_participants_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      client_alternate_contacts: {
        Row: {
          client_id: string
          created_at: string
          created_by: string | null
          designation: string | null
          email: string | null
          id: string
          name: string
          notes: string | null
          org_id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string | null
          designation?: string | null
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          org_id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string | null
          designation?: string | null
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          org_id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_alternate_contacts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_alternate_contacts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      client_documents: {
        Row: {
          client_id: string | null
          contact_id: string | null
          created_at: string
          description: string | null
          document_name: string
          document_type: string
          external_entity_id: string | null
          external_link: string | null
          file_url: string | null
          id: string
          org_id: string
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          client_id?: string | null
          contact_id?: string | null
          created_at?: string
          description?: string | null
          document_name: string
          document_type?: string
          external_entity_id?: string | null
          external_link?: string | null
          file_url?: string | null
          id?: string
          org_id: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          client_id?: string | null
          contact_id?: string | null
          created_at?: string
          description?: string | null
          document_name?: string
          document_type?: string
          external_entity_id?: string | null
          external_link?: string | null
          file_url?: string | null
          id?: string
          org_id?: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_documents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_documents_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_documents_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_with_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_documents_external_entity_id_fkey"
            columns: ["external_entity_id"]
            isOneToOne: false
            referencedRelation: "external_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_documents_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      client_invoices: {
        Row: {
          actual_payment_received: number | null
          amount: number
          client_id: string | null
          contact_id: string | null
          converted_from_quotation_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          document_type: string | null
          due_date: string | null
          external_entity_id: string | null
          file_url: string | null
          gst_rate: number | null
          id: string
          invoice_date: string
          invoice_number: string
          net_received_amount: number | null
          notes: string | null
          org_id: string
          payment_received_date: string | null
          status: string
          tax_amount: number | null
          tds_amount: number | null
          updated_at: string
        }
        Insert: {
          actual_payment_received?: number | null
          amount?: number
          client_id?: string | null
          contact_id?: string | null
          converted_from_quotation_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          document_type?: string | null
          due_date?: string | null
          external_entity_id?: string | null
          file_url?: string | null
          gst_rate?: number | null
          id?: string
          invoice_date: string
          invoice_number: string
          net_received_amount?: number | null
          notes?: string | null
          org_id: string
          payment_received_date?: string | null
          status?: string
          tax_amount?: number | null
          tds_amount?: number | null
          updated_at?: string
        }
        Update: {
          actual_payment_received?: number | null
          amount?: number
          client_id?: string | null
          contact_id?: string | null
          converted_from_quotation_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          document_type?: string | null
          due_date?: string | null
          external_entity_id?: string | null
          file_url?: string | null
          gst_rate?: number | null
          id?: string
          invoice_date?: string
          invoice_number?: string
          net_received_amount?: number | null
          notes?: string | null
          org_id?: string
          payment_received_date?: string | null
          status?: string
          tax_amount?: number | null
          tds_amount?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_invoices_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_invoices_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_invoices_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_with_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_invoices_converted_from_quotation_id_fkey"
            columns: ["converted_from_quotation_id"]
            isOneToOne: false
            referencedRelation: "client_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_invoices_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_invoices_external_entity_id_fkey"
            columns: ["external_entity_id"]
            isOneToOne: false
            referencedRelation: "external_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_invoices_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          address: string | null
          city: string | null
          company: string | null
          contact_id: string
          converted_at: string
          converted_by: string | null
          country: string | null
          created_at: string
          email: string | null
          first_name: string
          id: string
          job_title: string | null
          last_discussion: string | null
          last_discussion_at: string | null
          last_name: string | null
          notes: string | null
          org_id: string
          phone: string | null
          postal_code: string | null
          state: string | null
          status: string | null
          status_updated_at: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          city?: string | null
          company?: string | null
          contact_id: string
          converted_at?: string
          converted_by?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          first_name: string
          id?: string
          job_title?: string | null
          last_discussion?: string | null
          last_discussion_at?: string | null
          last_name?: string | null
          notes?: string | null
          org_id: string
          phone?: string | null
          postal_code?: string | null
          state?: string | null
          status?: string | null
          status_updated_at?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          city?: string | null
          company?: string | null
          contact_id?: string
          converted_at?: string
          converted_by?: string | null
          country?: string | null
          created_at?: string
          email?: string | null
          first_name?: string
          id?: string
          job_title?: string | null
          last_discussion?: string | null
          last_discussion_at?: string | null
          last_name?: string | null
          notes?: string | null
          org_id?: string
          phone?: string | null
          postal_code?: string | null
          state?: string | null
          status?: string | null
          status_updated_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_with_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_converted_by_fkey"
            columns: ["converted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      communication_templates: {
        Row: {
          approved_at: string | null
          buttons: Json | null
          category: string | null
          content: string
          created_at: string | null
          field_mappings: Json | null
          footer_text: string | null
          header_content: string | null
          header_type: string | null
          id: string
          language: string | null
          last_synced_at: string | null
          org_id: string
          rejection_reason: string | null
          sample_values: Json | null
          status: string | null
          submission_status: string | null
          submitted_at: string | null
          template_id: string
          template_name: string
          template_type: string
          updated_at: string | null
          variables: Json | null
        }
        Insert: {
          approved_at?: string | null
          buttons?: Json | null
          category?: string | null
          content: string
          created_at?: string | null
          field_mappings?: Json | null
          footer_text?: string | null
          header_content?: string | null
          header_type?: string | null
          id?: string
          language?: string | null
          last_synced_at?: string | null
          org_id: string
          rejection_reason?: string | null
          sample_values?: Json | null
          status?: string | null
          submission_status?: string | null
          submitted_at?: string | null
          template_id: string
          template_name: string
          template_type: string
          updated_at?: string | null
          variables?: Json | null
        }
        Update: {
          approved_at?: string | null
          buttons?: Json | null
          category?: string | null
          content?: string
          created_at?: string | null
          field_mappings?: Json | null
          footer_text?: string | null
          header_content?: string | null
          header_type?: string | null
          id?: string
          language?: string | null
          last_synced_at?: string | null
          org_id?: string
          rejection_reason?: string | null
          sample_values?: Json | null
          status?: string | null
          submission_status?: string | null
          submitted_at?: string | null
          template_id?: string
          template_name?: string
          template_type?: string
          updated_at?: string | null
          variables?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "communication_templates_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      company_holidays: {
        Row: {
          created_at: string | null
          day_of_week: string | null
          holiday_date: string
          holiday_name: string
          id: string
          is_optional: boolean | null
          notes: string | null
          org_id: string
          updated_at: string | null
          year: number
        }
        Insert: {
          created_at?: string | null
          day_of_week?: string | null
          holiday_date: string
          holiday_name: string
          id?: string
          is_optional?: boolean | null
          notes?: string | null
          org_id: string
          updated_at?: string | null
          year: number
        }
        Update: {
          created_at?: string | null
          day_of_week?: string | null
          holiday_date?: string
          holiday_name?: string
          id?: string
          is_optional?: boolean | null
          notes?: string | null
          org_id?: string
          updated_at?: string | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "company_holidays_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      connector_logs: {
        Row: {
          contact_id: string | null
          created_at: string | null
          error_message: string | null
          form_id: string | null
          http_status_code: number
          id: string
          ip_address: unknown
          org_id: string
          request_id: string
          request_payload: Json
          response_payload: Json | null
          status: string
        }
        Insert: {
          contact_id?: string | null
          created_at?: string | null
          error_message?: string | null
          form_id?: string | null
          http_status_code: number
          id?: string
          ip_address?: unknown
          org_id: string
          request_id: string
          request_payload?: Json
          response_payload?: Json | null
          status: string
        }
        Update: {
          contact_id?: string | null
          created_at?: string | null
          error_message?: string | null
          form_id?: string | null
          http_status_code?: number
          id?: string
          ip_address?: unknown
          org_id?: string
          request_id?: string
          request_payload?: Json
          response_payload?: Json | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "connector_logs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connector_logs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_with_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connector_logs_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "forms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connector_logs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      consent_records: {
        Row: {
          channels: string[]
          consent_version: string
          consented_at: string
          contact_id: string | null
          created_at: string
          data_principal_identifier: string
          id: string
          ip_address: string | null
          org_id: string
          purpose: string
          source: string | null
          status: string
          user_agent: string | null
          withdrawn_at: string | null
        }
        Insert: {
          channels?: string[]
          consent_version?: string
          consented_at?: string
          contact_id?: string | null
          created_at?: string
          data_principal_identifier: string
          id?: string
          ip_address?: string | null
          org_id: string
          purpose?: string
          source?: string | null
          status?: string
          user_agent?: string | null
          withdrawn_at?: string | null
        }
        Update: {
          channels?: string[]
          consent_version?: string
          consented_at?: string
          contact_id?: string | null
          created_at?: string
          data_principal_identifier?: string
          id?: string
          ip_address?: string | null
          org_id?: string
          purpose?: string
          source?: string | null
          status?: string
          user_agent?: string | null
          withdrawn_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "consent_records_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consent_records_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_with_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consent_records_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_activities: {
        Row: {
          activity_type: string
          ai_callback_triggered_at: string | null
          call_disposition_id: string | null
          call_duration: number | null
          call_sub_disposition_id: string | null
          check_in_latitude: number | null
          check_in_longitude: number | null
          check_out_latitude: number | null
          check_out_longitude: number | null
          completed_at: string | null
          contact_id: string | null
          created_at: string | null
          created_by: string | null
          demo_date: string | null
          demo_reminder_1h_sent_at: string | null
          demo_reminder_9am_sent_at: string | null
          demo_reminder_call_sent_at: string | null
          demo_rsvp_at: string | null
          demo_rsvp_status: string | null
          demo_slot_requested_at: string | null
          demo_time: string | null
          description: string | null
          duration_minutes: number | null
          google_calendar_event_id: string | null
          id: string
          location_accuracy: number | null
          meeting_duration_minutes: number | null
          meeting_link: string | null
          meeting_platform: string | null
          morning_reminder_sent: boolean | null
          next_action_date: string | null
          next_action_notes: string | null
          next_action_type: string | null
          org_id: string
          pre_action_reminder_sent: boolean | null
          priority: string | null
          recurring_pattern_id: string | null
          reminder_sent: boolean | null
          rsvp_token: string | null
          scheduled_at: string | null
          subject: string | null
          updated_at: string | null
        }
        Insert: {
          activity_type: string
          ai_callback_triggered_at?: string | null
          call_disposition_id?: string | null
          call_duration?: number | null
          call_sub_disposition_id?: string | null
          check_in_latitude?: number | null
          check_in_longitude?: number | null
          check_out_latitude?: number | null
          check_out_longitude?: number | null
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string | null
          created_by?: string | null
          demo_date?: string | null
          demo_reminder_1h_sent_at?: string | null
          demo_reminder_9am_sent_at?: string | null
          demo_reminder_call_sent_at?: string | null
          demo_rsvp_at?: string | null
          demo_rsvp_status?: string | null
          demo_slot_requested_at?: string | null
          demo_time?: string | null
          description?: string | null
          duration_minutes?: number | null
          google_calendar_event_id?: string | null
          id?: string
          location_accuracy?: number | null
          meeting_duration_minutes?: number | null
          meeting_link?: string | null
          meeting_platform?: string | null
          morning_reminder_sent?: boolean | null
          next_action_date?: string | null
          next_action_notes?: string | null
          next_action_type?: string | null
          org_id: string
          pre_action_reminder_sent?: boolean | null
          priority?: string | null
          recurring_pattern_id?: string | null
          reminder_sent?: boolean | null
          rsvp_token?: string | null
          scheduled_at?: string | null
          subject?: string | null
          updated_at?: string | null
        }
        Update: {
          activity_type?: string
          ai_callback_triggered_at?: string | null
          call_disposition_id?: string | null
          call_duration?: number | null
          call_sub_disposition_id?: string | null
          check_in_latitude?: number | null
          check_in_longitude?: number | null
          check_out_latitude?: number | null
          check_out_longitude?: number | null
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string | null
          created_by?: string | null
          demo_date?: string | null
          demo_reminder_1h_sent_at?: string | null
          demo_reminder_9am_sent_at?: string | null
          demo_reminder_call_sent_at?: string | null
          demo_rsvp_at?: string | null
          demo_rsvp_status?: string | null
          demo_slot_requested_at?: string | null
          demo_time?: string | null
          description?: string | null
          duration_minutes?: number | null
          google_calendar_event_id?: string | null
          id?: string
          location_accuracy?: number | null
          meeting_duration_minutes?: number | null
          meeting_link?: string | null
          meeting_platform?: string | null
          morning_reminder_sent?: boolean | null
          next_action_date?: string | null
          next_action_notes?: string | null
          next_action_type?: string | null
          org_id?: string
          pre_action_reminder_sent?: boolean | null
          priority?: string | null
          recurring_pattern_id?: string | null
          reminder_sent?: boolean | null
          rsvp_token?: string | null
          scheduled_at?: string | null
          subject?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_activities_call_disposition_id_fkey"
            columns: ["call_disposition_id"]
            isOneToOne: false
            referencedRelation: "call_dispositions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_activities_call_sub_disposition_id_fkey"
            columns: ["call_sub_disposition_id"]
            isOneToOne: false
            referencedRelation: "call_sub_dispositions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_activities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_activities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_with_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_activities_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_activities_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_activities_recurring_pattern_id_fkey"
            columns: ["recurring_pattern_id"]
            isOneToOne: false
            referencedRelation: "recurring_activity_patterns"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_custom_fields: {
        Row: {
          contact_id: string
          created_at: string
          custom_field_id: string
          field_value: string | null
          id: string
          updated_at: string
        }
        Insert: {
          contact_id: string
          created_at?: string
          custom_field_id: string
          field_value?: string | null
          id?: string
          updated_at?: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          custom_field_id?: string
          field_value?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_custom_fields_custom_field_id_fkey"
            columns: ["custom_field_id"]
            isOneToOne: false
            referencedRelation: "custom_fields"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_emails: {
        Row: {
          contact_id: string
          created_at: string
          email: string
          email_type: string
          id: string
          is_primary: boolean
          org_id: string
          updated_at: string
        }
        Insert: {
          contact_id: string
          created_at?: string
          email: string
          email_type?: string
          id?: string
          is_primary?: boolean
          org_id: string
          updated_at?: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          email?: string
          email_type?: string
          id?: string
          is_primary?: boolean
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_emails_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_emails_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_with_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_enrichment_logs: {
        Row: {
          contact_id: string
          created_at: string | null
          credits_used: number | null
          enriched_by: string | null
          enriched_data: Json | null
          enrichment_source: string
          error_message: string | null
          fields_enriched: string[] | null
          id: string
          org_id: string
          success: boolean
        }
        Insert: {
          contact_id: string
          created_at?: string | null
          credits_used?: number | null
          enriched_by?: string | null
          enriched_data?: Json | null
          enrichment_source?: string
          error_message?: string | null
          fields_enriched?: string[] | null
          id?: string
          org_id: string
          success: boolean
        }
        Update: {
          contact_id?: string
          created_at?: string | null
          credits_used?: number | null
          enriched_by?: string | null
          enriched_data?: Json | null
          enrichment_source?: string
          error_message?: string | null
          fields_enriched?: string[] | null
          id?: string
          org_id?: string
          success?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "contact_enrichment_logs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_enrichment_logs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_with_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_enrichment_logs_enriched_by_fkey"
            columns: ["enriched_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_enrichment_logs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_enrichment_runs: {
        Row: {
          completed_at: string | null
          contacts_enriched: number | null
          contacts_failed: number | null
          contacts_processed: number | null
          created_at: string
          credits_used: number | null
          error_message: string | null
          id: string
          org_id: string | null
          started_at: string
          status: string | null
        }
        Insert: {
          completed_at?: string | null
          contacts_enriched?: number | null
          contacts_failed?: number | null
          contacts_processed?: number | null
          created_at?: string
          credits_used?: number | null
          error_message?: string | null
          id?: string
          org_id?: string | null
          started_at?: string
          status?: string | null
        }
        Update: {
          completed_at?: string | null
          contacts_enriched?: number | null
          contacts_failed?: number | null
          contacts_processed?: number | null
          created_at?: string
          credits_used?: number | null
          error_message?: string | null
          id?: string
          org_id?: string | null
          started_at?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_enrichment_runs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_lead_scores: {
        Row: {
          contact_id: string
          id: string
          last_calculated: string
          org_id: string
          score: number
          score_breakdown: Json | null
          score_category: string | null
        }
        Insert: {
          contact_id: string
          id?: string
          last_calculated?: string
          org_id: string
          score?: number
          score_breakdown?: Json | null
          score_category?: string | null
        }
        Update: {
          contact_id?: string
          id?: string
          last_calculated?: string
          org_id?: string
          score?: number
          score_breakdown?: Json | null
          score_category?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_lead_scores_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: true
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_lead_scores_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: true
            referencedRelation: "contacts_with_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_lead_scores_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_phones: {
        Row: {
          contact_id: string
          created_at: string
          id: string
          is_primary: boolean
          org_id: string
          phone: string
          phone_type: string
          updated_at: string
        }
        Insert: {
          contact_id: string
          created_at?: string
          id?: string
          is_primary?: boolean
          org_id: string
          phone: string
          phone_type?: string
          updated_at?: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          id?: string
          is_primary?: boolean
          org_id?: string
          phone?: string
          phone_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_phones_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_phones_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_with_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_tag_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          contact_id: string
          id: string
          org_id: string
          tag_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          contact_id: string
          id?: string
          org_id: string
          tag_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          contact_id?: string
          id?: string
          org_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_tag_assignments_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_tag_assignments_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_with_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_tag_assignments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_tag_assignments_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "contact_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_tags: {
        Row: {
          color: string | null
          created_at: string
          description: string | null
          id: string
          name: string
          org_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name: string
          org_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_tags_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          address: string | null
          apollo_person_id: string | null
          assigned_team_id: string | null
          assigned_to: string | null
          city: string | null
          company: string | null
          country: string | null
          created_at: string | null
          created_by: string | null
          departments: string[] | null
          do_not_call: boolean
          do_not_email: boolean
          do_not_whatsapp: boolean
          education: Json | null
          email: string | null
          email_encrypted: string | null
          employment_history: Json | null
          enrichment_status: string | null
          facebook_url: string | null
          first_name: string
          gclid: string | null
          github_url: string | null
          headline: string | null
          id: string
          industry_type: string | null
          job_title: string | null
          last_enriched_at: string | null
          last_name: string | null
          last_verified_location_at: string | null
          latitude: number | null
          linkedin_url: string | null
          longitude: number | null
          name_hi: string | null
          nature_of_business: string | null
          notes: string | null
          opt_out_at: string | null
          opt_out_reason: string | null
          opted_out: boolean
          org_id: string
          organization_founded_year: number | null
          organization_industry: string | null
          organization_keywords: string[] | null
          organization_name: string | null
          person_locations: Json | null
          phone: string | null
          phone_encrypted: string | null
          phone_numbers: Json | null
          photo_url: string | null
          pipeline_stage_id: string | null
          postal_code: string | null
          preferred_demo_date: string | null
          preferred_demo_time: string | null
          product: string | null
          referred_by: string | null
          seniority: string | null
          source: string | null
          source_url: string | null
          state: string | null
          status: string | null
          team_size: string | null
          twitter_url: string | null
          updated_at: string | null
          utm_campaign: string | null
          utm_medium: string | null
          utm_source: string | null
          website: string | null
          whatsapp_outreach_status: string | null
        }
        Insert: {
          address?: string | null
          apollo_person_id?: string | null
          assigned_team_id?: string | null
          assigned_to?: string | null
          city?: string | null
          company?: string | null
          country?: string | null
          created_at?: string | null
          created_by?: string | null
          departments?: string[] | null
          do_not_call?: boolean
          do_not_email?: boolean
          do_not_whatsapp?: boolean
          education?: Json | null
          email?: string | null
          email_encrypted?: string | null
          employment_history?: Json | null
          enrichment_status?: string | null
          facebook_url?: string | null
          first_name: string
          gclid?: string | null
          github_url?: string | null
          headline?: string | null
          id?: string
          industry_type?: string | null
          job_title?: string | null
          last_enriched_at?: string | null
          last_name?: string | null
          last_verified_location_at?: string | null
          latitude?: number | null
          linkedin_url?: string | null
          longitude?: number | null
          name_hi?: string | null
          nature_of_business?: string | null
          notes?: string | null
          opt_out_at?: string | null
          opt_out_reason?: string | null
          opted_out?: boolean
          org_id: string
          organization_founded_year?: number | null
          organization_industry?: string | null
          organization_keywords?: string[] | null
          organization_name?: string | null
          person_locations?: Json | null
          phone?: string | null
          phone_encrypted?: string | null
          phone_numbers?: Json | null
          photo_url?: string | null
          pipeline_stage_id?: string | null
          postal_code?: string | null
          preferred_demo_date?: string | null
          preferred_demo_time?: string | null
          product?: string | null
          referred_by?: string | null
          seniority?: string | null
          source?: string | null
          source_url?: string | null
          state?: string | null
          status?: string | null
          team_size?: string | null
          twitter_url?: string | null
          updated_at?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          website?: string | null
          whatsapp_outreach_status?: string | null
        }
        Update: {
          address?: string | null
          apollo_person_id?: string | null
          assigned_team_id?: string | null
          assigned_to?: string | null
          city?: string | null
          company?: string | null
          country?: string | null
          created_at?: string | null
          created_by?: string | null
          departments?: string[] | null
          do_not_call?: boolean
          do_not_email?: boolean
          do_not_whatsapp?: boolean
          education?: Json | null
          email?: string | null
          email_encrypted?: string | null
          employment_history?: Json | null
          enrichment_status?: string | null
          facebook_url?: string | null
          first_name?: string
          gclid?: string | null
          github_url?: string | null
          headline?: string | null
          id?: string
          industry_type?: string | null
          job_title?: string | null
          last_enriched_at?: string | null
          last_name?: string | null
          last_verified_location_at?: string | null
          latitude?: number | null
          linkedin_url?: string | null
          longitude?: number | null
          name_hi?: string | null
          nature_of_business?: string | null
          notes?: string | null
          opt_out_at?: string | null
          opt_out_reason?: string | null
          opted_out?: boolean
          org_id?: string
          organization_founded_year?: number | null
          organization_industry?: string | null
          organization_keywords?: string[] | null
          organization_name?: string | null
          person_locations?: Json | null
          phone?: string | null
          phone_encrypted?: string | null
          phone_numbers?: Json | null
          photo_url?: string | null
          pipeline_stage_id?: string | null
          postal_code?: string | null
          preferred_demo_date?: string | null
          preferred_demo_time?: string | null
          product?: string | null
          referred_by?: string | null
          seniority?: string | null
          source?: string | null
          source_url?: string | null
          state?: string | null
          status?: string | null
          team_size?: string | null
          twitter_url?: string | null
          updated_at?: string | null
          utm_campaign?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          website?: string | null
          whatsapp_outreach_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_assigned_team_id_fkey"
            columns: ["assigned_team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_pipeline_stage_id_fkey"
            columns: ["pipeline_stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_fields: {
        Row: {
          applies_to_table: string
          created_at: string
          field_label: string
          field_name: string
          field_options: Json | null
          field_order: number
          field_type: string
          id: string
          is_active: boolean | null
          is_required: boolean | null
          org_id: string
          updated_at: string
        }
        Insert: {
          applies_to_table: string
          created_at?: string
          field_label: string
          field_name: string
          field_options?: Json | null
          field_order?: number
          field_type: string
          id?: string
          is_active?: boolean | null
          is_required?: boolean | null
          org_id: string
          updated_at?: string
        }
        Update: {
          applies_to_table?: string
          created_at?: string
          field_label?: string
          field_name?: string
          field_options?: Json | null
          field_order?: number
          field_type?: string
          id?: string
          is_active?: boolean | null
          is_required?: boolean | null
          org_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      data_breach_notifications: {
        Row: {
          affected_count: number | null
          contact_info: string
          description: string
          id: string
          impact: string
          org_id: string
          remedial_steps: string
          title: string
          triggered_at: string
          triggered_by: string | null
        }
        Insert: {
          affected_count?: number | null
          contact_info: string
          description: string
          id?: string
          impact: string
          org_id: string
          remedial_steps: string
          title: string
          triggered_at?: string
          triggered_by?: string | null
        }
        Update: {
          affected_count?: number | null
          contact_info?: string
          description?: string
          id?: string
          impact?: string
          org_id?: string
          remedial_steps?: string
          title?: string
          triggered_at?: string
          triggered_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "data_breach_notifications_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      data_requests: {
        Row: {
          admin_notes: string | null
          completed_at: string | null
          contact_id: string | null
          created_at: string
          details: string | null
          due_date: string
          handled_by: string | null
          id: string
          org_id: string
          request_type: string
          requester_identifier: string
          source: string | null
          status: string
        }
        Insert: {
          admin_notes?: string | null
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string
          details?: string | null
          due_date?: string
          handled_by?: string | null
          id?: string
          org_id: string
          request_type: string
          requester_identifier: string
          source?: string | null
          status?: string
        }
        Update: {
          admin_notes?: string | null
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string
          details?: string | null
          due_date?: string
          handled_by?: string | null
          id?: string
          org_id?: string
          request_type?: string
          requester_identifier?: string
          source?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "data_requests_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_requests_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_with_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_requests_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      designation_feature_access: {
        Row: {
          can_create: boolean | null
          can_delete: boolean | null
          can_edit: boolean | null
          can_view: boolean | null
          created_at: string | null
          custom_permissions: Json | null
          designation_id: string
          feature_key: string
          id: string
          org_id: string
          updated_at: string | null
        }
        Insert: {
          can_create?: boolean | null
          can_delete?: boolean | null
          can_edit?: boolean | null
          can_view?: boolean | null
          created_at?: string | null
          custom_permissions?: Json | null
          designation_id: string
          feature_key: string
          id?: string
          org_id: string
          updated_at?: string | null
        }
        Update: {
          can_create?: boolean | null
          can_delete?: boolean | null
          can_edit?: boolean | null
          can_view?: boolean | null
          created_at?: string | null
          custom_permissions?: Json | null
          designation_id?: string
          feature_key?: string
          id?: string
          org_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "designation_feature_access_designation_id_fkey"
            columns: ["designation_id"]
            isOneToOne: false
            referencedRelation: "designations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "designation_feature_access_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      designations: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          org_id: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          org_id: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          org_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string | null
        }
        Relationships: []
      }
      edu_attendance_punches: {
        Row: {
          attempts: number
          claimed_at: string | null
          created_at: string | null
          device_id: string
          direction: string
          id: string
          last_error: string | null
          org_id: string
          person_type: string
          photo: string | null
          punch_time: string
          pushed_at: string | null
          source: string
          student_id: string | null
          sync_status: string
          teacher_id: string | null
          upsmf_entry_id: number | null
          upsmf_identifier: string
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          created_at?: string | null
          device_id: string
          direction: string
          id?: string
          last_error?: string | null
          org_id: string
          person_type: string
          photo?: string | null
          punch_time: string
          pushed_at?: string | null
          source?: string
          student_id?: string | null
          sync_status?: string
          teacher_id?: string | null
          upsmf_entry_id?: number | null
          upsmf_identifier: string
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          created_at?: string | null
          device_id?: string
          direction?: string
          id?: string
          last_error?: string | null
          org_id?: string
          person_type?: string
          photo?: string | null
          punch_time?: string
          pushed_at?: string | null
          source?: string
          student_id?: string | null
          sync_status?: string
          teacher_id?: string | null
          upsmf_entry_id?: number | null
          upsmf_identifier?: string
        }
        Relationships: [
          {
            foreignKeyName: "edu_attendance_punches_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "edu_attendance_punches_student_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "edu_students"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "edu_attendance_punches_teacher_id_fkey"
            columns: ["teacher_id"]
            isOneToOne: false
            referencedRelation: "edu_teachers"
            referencedColumns: ["id"]
          },
        ]
      }
      edu_courses: {
        Row: {
          code: string
          created_at: string | null
          duration_months: number | null
          id: string
          name: string
          org_id: string
          status: string
          updated_at: string | null
        }
        Insert: {
          code: string
          created_at?: string | null
          duration_months?: number | null
          id?: string
          name: string
          org_id: string
          status?: string
          updated_at?: string | null
        }
        Update: {
          code?: string
          created_at?: string | null
          duration_months?: number | null
          id?: string
          name?: string
          org_id?: string
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "edu_courses_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      edu_devices: {
        Row: {
          created_at: string | null
          device_id: string
          id: string
          label: string | null
          org_id: string
          status: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          device_id: string
          id?: string
          label?: string | null
          org_id: string
          status?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          device_id?: string
          id?: string
          label?: string | null
          org_id?: string
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "edu_devices_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      edu_students: {
        Row: {
          admission_date: string | null
          course_id: string | null
          created_at: string | null
          date_of_birth: string | null
          device_enrollment_id: string | null
          enrollment_no: string
          father_name: string | null
          gender: string | null
          id: string
          mother_name: string | null
          name: string
          notes: string | null
          org_id: string
          phone: string | null
          status: string
          updated_at: string | null
        }
        Insert: {
          admission_date?: string | null
          course_id?: string | null
          created_at?: string | null
          date_of_birth?: string | null
          device_enrollment_id?: string | null
          enrollment_no: string
          father_name?: string | null
          gender?: string | null
          id?: string
          mother_name?: string | null
          name: string
          notes?: string | null
          org_id: string
          phone?: string | null
          status?: string
          updated_at?: string | null
        }
        Update: {
          admission_date?: string | null
          course_id?: string | null
          created_at?: string | null
          date_of_birth?: string | null
          device_enrollment_id?: string | null
          enrollment_no?: string
          father_name?: string | null
          gender?: string | null
          id?: string
          mother_name?: string | null
          name?: string
          notes?: string | null
          org_id?: string
          phone?: string | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "edu_students_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "edu_courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "edu_students_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      edu_teachers: {
        Row: {
          created_at: string | null
          designation: string | null
          device_enrollment_id: string | null
          email: string | null
          id: string
          name: string
          notes: string | null
          org_id: string
          phone: string | null
          qualification: string | null
          registration_detail: string | null
          status: string
          tutor_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          designation?: string | null
          device_enrollment_id?: string | null
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          org_id: string
          phone?: string | null
          qualification?: string | null
          registration_detail?: string | null
          status?: string
          tutor_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          designation?: string | null
          device_enrollment_id?: string | null
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          org_id?: string
          phone?: string | null
          qualification?: string | null
          registration_detail?: string | null
          status?: string
          tutor_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "edu_teachers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      edu_upload_log: {
        Row: {
          absent: number
          absentees: Json | null
          created_at: string | null
          direction: string
          id: string
          org_id: string
          present: number
          source: string
          total_active: number
          upload_date: string
        }
        Insert: {
          absent: number
          absentees?: Json | null
          created_at?: string | null
          direction: string
          id?: string
          org_id: string
          present: number
          source: string
          total_active: number
          upload_date: string
        }
        Update: {
          absent?: number
          absentees?: Json | null
          created_at?: string | null
          direction?: string
          id?: string
          org_id?: string
          present?: number
          source?: string
          total_active?: number
          upload_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "edu_upload_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_automation_cooldowns: {
        Row: {
          contact_id: string
          id: string
          last_sent_at: string
          org_id: string
          rule_id: string
          send_count: number | null
        }
        Insert: {
          contact_id: string
          id?: string
          last_sent_at: string
          org_id: string
          rule_id: string
          send_count?: number | null
        }
        Update: {
          contact_id?: string
          id?: string
          last_sent_at?: string
          org_id?: string
          rule_id?: string
          send_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "email_automation_cooldowns_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_automation_cooldowns_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_with_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_automation_cooldowns_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_automation_cooldowns_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "email_automation_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      email_automation_daily_limits: {
        Row: {
          contact_id: string
          email_count: number
          id: string
          last_sent_at: string
          org_id: string
          send_date: string
        }
        Insert: {
          contact_id: string
          email_count?: number
          id?: string
          last_sent_at?: string
          org_id: string
          send_date?: string
        }
        Update: {
          contact_id?: string
          email_count?: number
          id?: string
          last_sent_at?: string
          org_id?: string
          send_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_automation_daily_limits_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_automation_daily_limits_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_with_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_automation_daily_limits_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_automation_executions: {
        Row: {
          ab_test_id: string | null
          ab_variant_name: string | null
          contact_id: string
          conversion_type: string | null
          conversion_value: number | null
          converted_at: string | null
          created_at: string | null
          email_conversation_id: string | null
          email_subject: string | null
          email_template_id: string | null
          error_message: string | null
          id: string
          max_retries: number | null
          next_retry_at: string | null
          org_id: string
          retry_count: number | null
          rule_id: string
          scheduled_for: string | null
          sent_at: string | null
          status: string
          trigger_data: Json | null
          trigger_type: string
          updated_at: string | null
        }
        Insert: {
          ab_test_id?: string | null
          ab_variant_name?: string | null
          contact_id: string
          conversion_type?: string | null
          conversion_value?: number | null
          converted_at?: string | null
          created_at?: string | null
          email_conversation_id?: string | null
          email_subject?: string | null
          email_template_id?: string | null
          error_message?: string | null
          id?: string
          max_retries?: number | null
          next_retry_at?: string | null
          org_id: string
          retry_count?: number | null
          rule_id: string
          scheduled_for?: string | null
          sent_at?: string | null
          status?: string
          trigger_data?: Json | null
          trigger_type: string
          updated_at?: string | null
        }
        Update: {
          ab_test_id?: string | null
          ab_variant_name?: string | null
          contact_id?: string
          conversion_type?: string | null
          conversion_value?: number | null
          converted_at?: string | null
          created_at?: string | null
          email_conversation_id?: string | null
          email_subject?: string | null
          email_template_id?: string | null
          error_message?: string | null
          id?: string
          max_retries?: number | null
          next_retry_at?: string | null
          org_id?: string
          retry_count?: number | null
          rule_id?: string
          scheduled_for?: string | null
          sent_at?: string | null
          status?: string
          trigger_data?: Json | null
          trigger_type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_automation_executions_ab_test_id_fkey"
            columns: ["ab_test_id"]
            isOneToOne: false
            referencedRelation: "automation_ab_tests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_automation_executions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_automation_executions_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_with_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_automation_executions_email_conversation_id_fkey"
            columns: ["email_conversation_id"]
            isOneToOne: false
            referencedRelation: "email_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_automation_executions_email_template_id_fkey"
            columns: ["email_template_id"]
            isOneToOne: false
            referencedRelation: "email_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_automation_executions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_automation_executions_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "email_automation_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      email_automation_rule_dependencies: {
        Row: {
          created_at: string
          delay_minutes: number | null
          dependency_type: string
          depends_on_rule_id: string
          id: string
          org_id: string
          rule_id: string
        }
        Insert: {
          created_at?: string
          delay_minutes?: number | null
          dependency_type: string
          depends_on_rule_id: string
          id?: string
          org_id: string
          rule_id: string
        }
        Update: {
          created_at?: string
          delay_minutes?: number | null
          dependency_type?: string
          depends_on_rule_id?: string
          id?: string
          org_id?: string
          rule_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_automation_rule_dependencies_depends_on_rule_id_fkey"
            columns: ["depends_on_rule_id"]
            isOneToOne: false
            referencedRelation: "email_automation_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_automation_rule_dependencies_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_automation_rule_dependencies_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "email_automation_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      email_automation_rule_templates: {
        Row: {
          category: string
          condition_logic: string | null
          conditions: Json | null
          cooldown_period_days: number | null
          created_at: string
          description: string | null
          icon: string | null
          id: string
          is_popular: boolean | null
          name: string
          priority: number | null
          send_delay_minutes: number | null
          trigger_config: Json
          trigger_type: string
          updated_at: string
          use_count: number | null
        }
        Insert: {
          category: string
          condition_logic?: string | null
          conditions?: Json | null
          cooldown_period_days?: number | null
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          is_popular?: boolean | null
          name: string
          priority?: number | null
          send_delay_minutes?: number | null
          trigger_config?: Json
          trigger_type: string
          updated_at?: string
          use_count?: number | null
        }
        Update: {
          category?: string
          condition_logic?: string | null
          conditions?: Json | null
          cooldown_period_days?: number | null
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          is_popular?: boolean | null
          name?: string
          priority?: number | null
          send_delay_minutes?: number | null
          trigger_config?: Json
          trigger_type?: string
          updated_at?: string
          use_count?: number | null
        }
        Relationships: []
      }
      email_automation_rules: {
        Row: {
          ab_test_enabled: boolean
          approval_timeout_hours: number | null
          condition_logic: string | null
          conditions: Json | null
          cooldown_period_days: number | null
          created_at: string | null
          created_by: string | null
          description: string | null
          email_template_id: string | null
          enforce_business_hours: boolean
          id: string
          is_active: boolean | null
          max_sends_per_contact: number | null
          name: string
          org_id: string
          priority: number | null
          requires_approval: boolean | null
          send_at_specific_time: string | null
          send_delay_minutes: number | null
          send_on_business_days_only: boolean | null
          total_failed: number | null
          total_sent: number | null
          total_triggered: number | null
          trigger_config: Json
          trigger_type: string
          updated_at: string | null
          whatsapp_template_id: string | null
        }
        Insert: {
          ab_test_enabled?: boolean
          approval_timeout_hours?: number | null
          condition_logic?: string | null
          conditions?: Json | null
          cooldown_period_days?: number | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          email_template_id?: string | null
          enforce_business_hours?: boolean
          id?: string
          is_active?: boolean | null
          max_sends_per_contact?: number | null
          name: string
          org_id: string
          priority?: number | null
          requires_approval?: boolean | null
          send_at_specific_time?: string | null
          send_delay_minutes?: number | null
          send_on_business_days_only?: boolean | null
          total_failed?: number | null
          total_sent?: number | null
          total_triggered?: number | null
          trigger_config?: Json
          trigger_type: string
          updated_at?: string | null
          whatsapp_template_id?: string | null
        }
        Update: {
          ab_test_enabled?: boolean
          approval_timeout_hours?: number | null
          condition_logic?: string | null
          conditions?: Json | null
          cooldown_period_days?: number | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          email_template_id?: string | null
          enforce_business_hours?: boolean
          id?: string
          is_active?: boolean | null
          max_sends_per_contact?: number | null
          name?: string
          org_id?: string
          priority?: number | null
          requires_approval?: boolean | null
          send_at_specific_time?: string | null
          send_delay_minutes?: number | null
          send_on_business_days_only?: boolean | null
          total_failed?: number | null
          total_sent?: number | null
          total_triggered?: number | null
          trigger_config?: Json
          trigger_type?: string
          updated_at?: string | null
          whatsapp_template_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_automation_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_automation_rules_email_template_id_fkey"
            columns: ["email_template_id"]
            isOneToOne: false
            referencedRelation: "email_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_automation_rules_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_automation_rules_whatsapp_template_id_fkey"
            columns: ["whatsapp_template_id"]
            isOneToOne: false
            referencedRelation: "communication_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      email_bulk_campaigns: {
        Row: {
          attachments: Json | null
          body_content: string | null
          buttons: Json | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          failed_count: number
          html_content: string
          id: string
          name: string
          org_id: string
          pending_count: number
          scheduled_at: string | null
          sent_count: number
          started_at: string | null
          status: string
          subject: string
          template_id: string | null
          total_recipients: number
          updated_at: string
          variable_mappings: Json | null
        }
        Insert: {
          attachments?: Json | null
          body_content?: string | null
          buttons?: Json | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          failed_count?: number
          html_content: string
          id?: string
          name: string
          org_id: string
          pending_count?: number
          scheduled_at?: string | null
          sent_count?: number
          started_at?: string | null
          status?: string
          subject: string
          template_id?: string | null
          total_recipients?: number
          updated_at?: string
          variable_mappings?: Json | null
        }
        Update: {
          attachments?: Json | null
          body_content?: string | null
          buttons?: Json | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          failed_count?: number
          html_content?: string
          id?: string
          name?: string
          org_id?: string
          pending_count?: number
          scheduled_at?: string | null
          sent_count?: number
          started_at?: string | null
          status?: string
          subject?: string
          template_id?: string | null
          total_recipients?: number
          updated_at?: string
          variable_mappings?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "email_bulk_campaigns_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_bulk_campaigns_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "email_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      email_campaign_recipients: {
        Row: {
          bounce_reason: string | null
          bounced_at: string | null
          button_clicks: Json | null
          campaign_id: string
          click_count: number | null
          complained_at: string | null
          contact_id: string | null
          created_at: string
          custom_data: Json | null
          delivered_at: string | null
          email: string
          error_message: string | null
          first_clicked_at: string | null
          id: string
          open_count: number | null
          opened_at: string | null
          resend_email_id: string | null
          sent_at: string | null
          status: string
          tracking_pixel_id: string | null
          updated_at: string
        }
        Insert: {
          bounce_reason?: string | null
          bounced_at?: string | null
          button_clicks?: Json | null
          campaign_id: string
          click_count?: number | null
          complained_at?: string | null
          contact_id?: string | null
          created_at?: string
          custom_data?: Json | null
          delivered_at?: string | null
          email: string
          error_message?: string | null
          first_clicked_at?: string | null
          id?: string
          open_count?: number | null
          opened_at?: string | null
          resend_email_id?: string | null
          sent_at?: string | null
          status?: string
          tracking_pixel_id?: string | null
          updated_at?: string
        }
        Update: {
          bounce_reason?: string | null
          bounced_at?: string | null
          button_clicks?: Json | null
          campaign_id?: string
          click_count?: number | null
          complained_at?: string | null
          contact_id?: string | null
          created_at?: string
          custom_data?: Json | null
          delivered_at?: string | null
          email?: string
          error_message?: string | null
          first_clicked_at?: string | null
          id?: string
          open_count?: number | null
          opened_at?: string | null
          resend_email_id?: string | null
          sent_at?: string | null
          status?: string
          tracking_pixel_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_campaign_recipients_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "email_bulk_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_campaign_recipients_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_campaign_recipients_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_with_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      email_conversations: {
        Row: {
          attachments: Json | null
          bcc_emails: string[] | null
          bounce_reason: string | null
          bounced_at: string | null
          button_clicks: Json | null
          cc_emails: string[] | null
          click_count: number
          complained_at: string | null
          contact_id: string | null
          conversation_id: string
          created_at: string | null
          delivered_at: string | null
          direction: string
          email_content: string
          first_clicked_at: string | null
          from_email: string
          from_name: string | null
          has_attachments: boolean | null
          html_content: string | null
          id: string
          is_read: boolean | null
          open_count: number
          opened_at: string | null
          org_id: string
          provider_message_id: string | null
          read_at: string | null
          received_at: string | null
          replied_to_message_id: string | null
          reply_to_email: string | null
          scheduled_at: string | null
          sent_at: string | null
          sent_by: string | null
          status: string | null
          subject: string
          thread_id: string | null
          to_email: string
          tracking_pixel_id: string | null
          unsubscribe_token: string | null
          updated_at: string | null
        }
        Insert: {
          attachments?: Json | null
          bcc_emails?: string[] | null
          bounce_reason?: string | null
          bounced_at?: string | null
          button_clicks?: Json | null
          cc_emails?: string[] | null
          click_count?: number
          complained_at?: string | null
          contact_id?: string | null
          conversation_id: string
          created_at?: string | null
          delivered_at?: string | null
          direction: string
          email_content: string
          first_clicked_at?: string | null
          from_email: string
          from_name?: string | null
          has_attachments?: boolean | null
          html_content?: string | null
          id?: string
          is_read?: boolean | null
          open_count?: number
          opened_at?: string | null
          org_id: string
          provider_message_id?: string | null
          read_at?: string | null
          received_at?: string | null
          replied_to_message_id?: string | null
          reply_to_email?: string | null
          scheduled_at?: string | null
          sent_at?: string | null
          sent_by?: string | null
          status?: string | null
          subject: string
          thread_id?: string | null
          to_email: string
          tracking_pixel_id?: string | null
          unsubscribe_token?: string | null
          updated_at?: string | null
        }
        Update: {
          attachments?: Json | null
          bcc_emails?: string[] | null
          bounce_reason?: string | null
          bounced_at?: string | null
          button_clicks?: Json | null
          cc_emails?: string[] | null
          click_count?: number
          complained_at?: string | null
          contact_id?: string | null
          conversation_id?: string
          created_at?: string | null
          delivered_at?: string | null
          direction?: string
          email_content?: string
          first_clicked_at?: string | null
          from_email?: string
          from_name?: string | null
          has_attachments?: boolean | null
          html_content?: string | null
          id?: string
          is_read?: boolean | null
          open_count?: number
          opened_at?: string | null
          org_id?: string
          provider_message_id?: string | null
          read_at?: string | null
          received_at?: string | null
          replied_to_message_id?: string | null
          reply_to_email?: string | null
          scheduled_at?: string | null
          sent_at?: string | null
          sent_by?: string | null
          status?: string | null
          subject?: string
          thread_id?: string | null
          to_email?: string
          tracking_pixel_id?: string | null
          unsubscribe_token?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_conversations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_conversations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_with_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_conversations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_conversations_replied_to_message_id_fkey"
            columns: ["replied_to_message_id"]
            isOneToOne: false
            referencedRelation: "email_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_engagement_patterns: {
        Row: {
          click_count: number | null
          contact_id: string | null
          day_of_week: number
          engagement_score: number | null
          hour_of_day: number
          id: string
          last_updated: string
          open_count: number | null
          org_id: string
        }
        Insert: {
          click_count?: number | null
          contact_id?: string | null
          day_of_week: number
          engagement_score?: number | null
          hour_of_day: number
          id?: string
          last_updated?: string
          open_count?: number | null
          org_id: string
        }
        Update: {
          click_count?: number | null
          contact_id?: string | null
          day_of_week?: number
          engagement_score?: number | null
          hour_of_day?: number
          id?: string
          last_updated?: string
          open_count?: number | null
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_engagement_patterns_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_engagement_patterns_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_with_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_engagement_patterns_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_settings: {
        Row: {
          created_at: string | null
          dns_records: Json | null
          id: string
          inbound_route_id: string | null
          inbound_routing_enabled: boolean | null
          inbound_webhook_url: string | null
          is_active: boolean | null
          org_id: string
          resend_domain_id: string | null
          sending_domain: string
          updated_at: string | null
          verification_status: string
          verified_at: string | null
        }
        Insert: {
          created_at?: string | null
          dns_records?: Json | null
          id?: string
          inbound_route_id?: string | null
          inbound_routing_enabled?: boolean | null
          inbound_webhook_url?: string | null
          is_active?: boolean | null
          org_id: string
          resend_domain_id?: string | null
          sending_domain: string
          updated_at?: string | null
          verification_status?: string
          verified_at?: string | null
        }
        Update: {
          created_at?: string | null
          dns_records?: Json | null
          id?: string
          inbound_route_id?: string | null
          inbound_routing_enabled?: boolean | null
          inbound_webhook_url?: string | null
          is_active?: boolean | null
          org_id?: string
          resend_domain_id?: string | null
          sending_domain?: string
          updated_at?: string | null
          verification_status?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_settings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_suppression_list: {
        Row: {
          created_at: string
          email: string
          id: string
          notes: string | null
          org_id: string
          reason: string
          suppressed_at: string
          suppressed_by: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          notes?: string | null
          org_id: string
          reason: string
          suppressed_at?: string
          suppressed_by?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          notes?: string | null
          org_id?: string
          reason?: string
          suppressed_at?: string
          suppressed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_suppression_list_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_templates: {
        Row: {
          attachments: Json | null
          body_content: string | null
          buttons: Json | null
          created_at: string
          created_by: string | null
          design_json: Json | null
          html_content: string | null
          id: string
          is_active: boolean
          name: string
          org_id: string
          subject: string
          updated_at: string
        }
        Insert: {
          attachments?: Json | null
          body_content?: string | null
          buttons?: Json | null
          created_at?: string
          created_by?: string | null
          design_json?: Json | null
          html_content?: string | null
          id?: string
          is_active?: boolean
          name: string
          org_id: string
          subject: string
          updated_at?: string
        }
        Update: {
          attachments?: Json | null
          body_content?: string | null
          buttons?: Json | null
          created_at?: string
          created_by?: string | null
          design_json?: Json | null
          html_content?: string | null
          id?: string
          is_active?: boolean
          name?: string
          org_id?: string
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_templates_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_unsubscribes: {
        Row: {
          contact_id: string | null
          email: string
          id: string
          ip_address: unknown
          org_id: string
          source: string
          unsubscribe_token: string
          unsubscribed_at: string
          user_agent: string | null
        }
        Insert: {
          contact_id?: string | null
          email: string
          id?: string
          ip_address?: unknown
          org_id: string
          source: string
          unsubscribe_token: string
          unsubscribed_at?: string
          user_agent?: string | null
        }
        Update: {
          contact_id?: string | null
          email?: string
          id?: string
          ip_address?: unknown
          org_id?: string
          source?: string
          unsubscribe_token?: string
          unsubscribed_at?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_unsubscribes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_unsubscribes_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_with_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_unsubscribes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      error_logs: {
        Row: {
          created_at: string
          error_details: Json | null
          error_message: string
          error_type: string
          id: string
          org_id: string
          page_url: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          error_details?: Json | null
          error_message: string
          error_type: string
          id?: string
          org_id: string
          page_url?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          error_details?: Json | null
          error_message?: string
          error_type?: string
          id?: string
          org_id?: string
          page_url?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "error_logs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "error_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      exotel_exophones: {
        Row: {
          created_at: string
          friendly_name: string | null
          id: string
          is_active: boolean
          is_default: boolean
          org_id: string
          phone_number: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          friendly_name?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          org_id: string
          phone_number: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          friendly_name?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          org_id?: string
          phone_number?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exotel_exophones_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      exotel_settings: {
        Row: {
          account_sid: string
          api_key: string
          api_token: string
          call_recording_enabled: boolean | null
          caller_id: string
          created_at: string | null
          id: string
          is_active: boolean | null
          org_id: string
          sms_enabled: boolean | null
          sms_sender_id: string | null
          subdomain: string
          updated_at: string | null
          waba_id: string | null
          whatsapp_account_sid: string | null
          whatsapp_api_key: string | null
          whatsapp_api_token: string | null
          whatsapp_enabled: boolean | null
          whatsapp_source_number: string | null
          whatsapp_subdomain: string | null
        }
        Insert: {
          account_sid: string
          api_key: string
          api_token: string
          call_recording_enabled?: boolean | null
          caller_id: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          org_id: string
          sms_enabled?: boolean | null
          sms_sender_id?: string | null
          subdomain?: string
          updated_at?: string | null
          waba_id?: string | null
          whatsapp_account_sid?: string | null
          whatsapp_api_key?: string | null
          whatsapp_api_token?: string | null
          whatsapp_enabled?: boolean | null
          whatsapp_source_number?: string | null
          whatsapp_subdomain?: string | null
        }
        Update: {
          account_sid?: string
          api_key?: string
          api_token?: string
          call_recording_enabled?: boolean | null
          caller_id?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          org_id?: string
          sms_enabled?: boolean | null
          sms_sender_id?: string | null
          subdomain?: string
          updated_at?: string | null
          waba_id?: string | null
          whatsapp_account_sid?: string | null
          whatsapp_api_key?: string | null
          whatsapp_api_token?: string | null
          whatsapp_enabled?: boolean | null
          whatsapp_source_number?: string | null
          whatsapp_subdomain?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exotel_settings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      external_entities: {
        Row: {
          address: string | null
          city: string | null
          company: string | null
          country: string | null
          created_at: string
          created_by: string | null
          email: string | null
          entity_type: string
          id: string
          name: string
          notes: string | null
          org_id: string
          phone: string | null
          postal_code: string | null
          state: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          city?: string | null
          company?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          entity_type?: string
          id?: string
          name: string
          notes?: string | null
          org_id: string
          phone?: string | null
          postal_code?: string | null
          state?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          city?: string | null
          company?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          entity_type?: string
          id?: string
          name?: string
          notes?: string | null
          org_id?: string
          phone?: string | null
          postal_code?: string | null
          state?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "external_entities_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_permissions: {
        Row: {
          category: string
          created_at: string | null
          feature_description: string | null
          feature_key: string
          feature_name: string
          id: string
          is_premium: boolean | null
        }
        Insert: {
          category: string
          created_at?: string | null
          feature_description?: string | null
          feature_key: string
          feature_name: string
          id?: string
          is_premium?: boolean | null
        }
        Update: {
          category?: string
          created_at?: string | null
          feature_description?: string | null
          feature_key?: string
          feature_name?: string
          id?: string
          is_premium?: boolean | null
        }
        Relationships: []
      }
      fervent_data_repository: {
        Row: {
          city: string | null
          company_linkedin_url: string | null
          company_name: string | null
          country: string | null
          created_at: string | null
          created_by: string | null
          db_sourced_year: number | null
          department: string | null
          designation: string | null
          designation_level: string | null
          direct_number: string | null
          domain_name: string | null
          employee_size: string | null
          first_name: string | null
          id: string
          import_job_id: string | null
          industry: string | null
          last_name: string | null
          linkedin_url: string | null
          mobile_number_1: string | null
          mobile_number_2: string | null
          official_email: string | null
          org_id: string
          personal_email_1: string | null
          personal_email_2: string | null
          phone_number: string | null
          sr_no: number | null
          state: string | null
          std_code: string | null
          sub_industry: string | null
          turnover: string | null
          turnover_usd_million: number | null
          ucdb_status: string | null
          unique_id: string | null
          updated_at: string | null
          website: string | null
        }
        Insert: {
          city?: string | null
          company_linkedin_url?: string | null
          company_name?: string | null
          country?: string | null
          created_at?: string | null
          created_by?: string | null
          db_sourced_year?: number | null
          department?: string | null
          designation?: string | null
          designation_level?: string | null
          direct_number?: string | null
          domain_name?: string | null
          employee_size?: string | null
          first_name?: string | null
          id?: string
          import_job_id?: string | null
          industry?: string | null
          last_name?: string | null
          linkedin_url?: string | null
          mobile_number_1?: string | null
          mobile_number_2?: string | null
          official_email?: string | null
          org_id: string
          personal_email_1?: string | null
          personal_email_2?: string | null
          phone_number?: string | null
          sr_no?: number | null
          state?: string | null
          std_code?: string | null
          sub_industry?: string | null
          turnover?: string | null
          turnover_usd_million?: number | null
          ucdb_status?: string | null
          unique_id?: string | null
          updated_at?: string | null
          website?: string | null
        }
        Update: {
          city?: string | null
          company_linkedin_url?: string | null
          company_name?: string | null
          country?: string | null
          created_at?: string | null
          created_by?: string | null
          db_sourced_year?: number | null
          department?: string | null
          designation?: string | null
          designation_level?: string | null
          direct_number?: string | null
          domain_name?: string | null
          employee_size?: string | null
          first_name?: string | null
          id?: string
          import_job_id?: string | null
          industry?: string | null
          last_name?: string | null
          linkedin_url?: string | null
          mobile_number_1?: string | null
          mobile_number_2?: string | null
          official_email?: string | null
          org_id?: string
          personal_email_1?: string | null
          personal_email_2?: string | null
          phone_number?: string | null
          sr_no?: number | null
          state?: string | null
          std_code?: string | null
          sub_industry?: string | null
          turnover?: string | null
          turnover_usd_million?: number | null
          ucdb_status?: string | null
          unique_id?: string | null
          updated_at?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fervent_data_repository_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fervent_data_repository_import_job_id_fkey"
            columns: ["import_job_id"]
            isOneToOne: false
            referencedRelation: "import_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      fervent_activity_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string | null
          detail: Json | null
          id: string
          org_id: string
          record_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string | null
          detail?: Json | null
          id?: string
          org_id: string
          record_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string | null
          detail?: Json | null
          id?: string
          org_id?: string
          record_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fervent_activity_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fervent_activity_log_record_id_fkey"
            columns: ["record_id"]
            isOneToOne: false
            referencedRelation: "fervent_data_repository"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fervent_activity_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      fervent_saved_searches: {
        Row: {
          created_at: string | null
          created_by: string | null
          definition: Json
          id: string
          name: string
          org_id: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          definition: Json
          id?: string
          name: string
          org_id: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          definition?: Json
          id?: string
          name?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fervent_saved_searches_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fervent_saved_searches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      form_fields: {
        Row: {
          created_at: string | null
          custom_field_id: string
          field_order: number
          form_id: string
          id: string
        }
        Insert: {
          created_at?: string | null
          custom_field_id: string
          field_order?: number
          form_id: string
          id?: string
        }
        Update: {
          created_at?: string | null
          custom_field_id?: string
          field_order?: number
          form_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "form_fields_custom_field_id_fkey"
            columns: ["custom_field_id"]
            isOneToOne: false
            referencedRelation: "custom_fields"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "form_fields_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "forms"
            referencedColumns: ["id"]
          },
        ]
      }
      forms: {
        Row: {
          connector_type: string | null
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          org_id: string
          rate_limit_per_minute: number | null
          updated_at: string | null
          webhook_config: Json | null
          webhook_token: string | null
        }
        Insert: {
          connector_type?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          org_id: string
          rate_limit_per_minute?: number | null
          updated_at?: string | null
          webhook_config?: Json | null
          webhook_token?: string | null
        }
        Update: {
          connector_type?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          org_id?: string
          rate_limit_per_minute?: number | null
          updated_at?: string | null
          webhook_config?: Json | null
          webhook_token?: string | null
        }
        Relationships: []
      }
      google_oauth_tokens: {
        Row: {
          access_token: string | null
          calendar_id: string | null
          created_at: string | null
          id: string
          org_id: string
          refresh_token: string
          token_expires_at: string | null
          updated_at: string | null
          user_email: string | null
        }
        Insert: {
          access_token?: string | null
          calendar_id?: string | null
          created_at?: string | null
          id?: string
          org_id: string
          refresh_token: string
          token_expires_at?: string | null
          updated_at?: string | null
          user_email?: string | null
        }
        Update: {
          access_token?: string | null
          calendar_id?: string | null
          created_at?: string | null
          id?: string
          org_id?: string
          refresh_token?: string
          token_expires_at?: string | null
          updated_at?: string | null
          user_email?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "google_oauth_tokens_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      gst_payment_tracking: {
        Row: {
          amount_paid: number | null
          created_at: string
          created_by: string | null
          gst_collected: number
          id: string
          month: number
          notes: string | null
          org_id: string
          payment_date: string | null
          payment_reference: string | null
          payment_status: string
          updated_at: string
          year: number
        }
        Insert: {
          amount_paid?: number | null
          created_at?: string
          created_by?: string | null
          gst_collected?: number
          id?: string
          month: number
          notes?: string | null
          org_id: string
          payment_date?: string | null
          payment_reference?: string | null
          payment_status?: string
          updated_at?: string
          year: number
        }
        Update: {
          amount_paid?: number | null
          created_at?: string
          created_by?: string | null
          gst_collected?: number
          id?: string
          month?: number
          notes?: string | null
          org_id?: string
          payment_date?: string | null
          payment_reference?: string | null
          payment_status?: string
          updated_at?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "gst_payment_tracking_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      import_jobs: {
        Row: {
          completed_at: string | null
          created_at: string | null
          current_stage: string | null
          duplicate_count: number | null
          error_count: number | null
          error_details: Json | null
          file_cleaned_up: boolean | null
          file_cleanup_at: string | null
          file_name: string
          file_path: string
          id: string
          import_type: string
          org_id: string
          processed_rows: number | null
          stage_details: Json | null
          started_at: string | null
          status: string
          success_count: number | null
          target_id: string | null
          total_rows: number | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          current_stage?: string | null
          duplicate_count?: number | null
          error_count?: number | null
          error_details?: Json | null
          file_cleaned_up?: boolean | null
          file_cleanup_at?: string | null
          file_name: string
          file_path: string
          id?: string
          import_type: string
          org_id: string
          processed_rows?: number | null
          stage_details?: Json | null
          started_at?: string | null
          status?: string
          success_count?: number | null
          target_id?: string | null
          total_rows?: number | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          current_stage?: string | null
          duplicate_count?: number | null
          error_count?: number | null
          error_details?: Json | null
          file_cleaned_up?: boolean | null
          file_cleanup_at?: string | null
          file_name?: string
          file_path?: string
          id?: string
          import_type?: string
          org_id?: string
          processed_rows?: number | null
          stage_details?: Json | null
          started_at?: string | null
          status?: string
          success_count?: number | null
          target_id?: string | null
          total_rows?: number | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_jobs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      import_staging: {
        Row: {
          created_at: string | null
          id: string
          import_id: string
          processed: boolean | null
          raw_data: Json
          row_number: number
        }
        Insert: {
          created_at?: string | null
          id?: string
          import_id: string
          processed?: boolean | null
          raw_data: Json
          row_number: number
        }
        Update: {
          created_at?: string | null
          id?: string
          import_id?: string
          processed?: boolean | null
          raw_data?: Json
          row_number?: number
        }
        Relationships: []
      }
      invoice_import_items: {
        Row: {
          action: string | null
          amount: number | null
          client_address: string | null
          client_company: string | null
          client_email: string | null
          client_name: string | null
          client_phone: string | null
          created_at: string
          created_client_id: string | null
          created_contact_id: string | null
          currency: string | null
          due_date: string | null
          duplicate_status: string
          error_message: string | null
          extracted_data: Json | null
          file_name: string
          file_url: string | null
          id: string
          import_id: string
          invoice_date: string | null
          invoice_number: string | null
          matched_client_id: string | null
          matched_contact_id: string | null
          org_id: string
          potential_matches: Json | null
          status: string
          tax_amount: number | null
          updated_at: string
        }
        Insert: {
          action?: string | null
          amount?: number | null
          client_address?: string | null
          client_company?: string | null
          client_email?: string | null
          client_name?: string | null
          client_phone?: string | null
          created_at?: string
          created_client_id?: string | null
          created_contact_id?: string | null
          currency?: string | null
          due_date?: string | null
          duplicate_status?: string
          error_message?: string | null
          extracted_data?: Json | null
          file_name: string
          file_url?: string | null
          id?: string
          import_id: string
          invoice_date?: string | null
          invoice_number?: string | null
          matched_client_id?: string | null
          matched_contact_id?: string | null
          org_id: string
          potential_matches?: Json | null
          status?: string
          tax_amount?: number | null
          updated_at?: string
        }
        Update: {
          action?: string | null
          amount?: number | null
          client_address?: string | null
          client_company?: string | null
          client_email?: string | null
          client_name?: string | null
          client_phone?: string | null
          created_at?: string
          created_client_id?: string | null
          created_contact_id?: string | null
          currency?: string | null
          due_date?: string | null
          duplicate_status?: string
          error_message?: string | null
          extracted_data?: Json | null
          file_name?: string
          file_url?: string | null
          id?: string
          import_id?: string
          invoice_date?: string | null
          invoice_number?: string | null
          matched_client_id?: string | null
          matched_contact_id?: string | null
          org_id?: string
          potential_matches?: Json | null
          status?: string
          tax_amount?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_import_items_created_client_id_fkey"
            columns: ["created_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_import_items_created_contact_id_fkey"
            columns: ["created_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_import_items_created_contact_id_fkey"
            columns: ["created_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_with_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_import_items_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "invoice_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_import_items_matched_client_id_fkey"
            columns: ["matched_client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_import_items_matched_contact_id_fkey"
            columns: ["matched_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_import_items_matched_contact_id_fkey"
            columns: ["matched_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_with_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_import_items_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_imports: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string | null
          id: string
          org_id: string
          processed_files: number
          status: string
          total_files: number
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          org_id: string
          processed_files?: number
          status?: string
          total_files?: number
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          org_id?: string
          processed_files?: number
          status?: string
          total_files?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_imports_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_imports_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_assignment_rules: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean
          org_id: string
          owner_id: string
          product: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean
          org_id: string
          owner_id: string
          product: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean
          org_id?: string
          owner_id?: string
          product?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_assignment_rules_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_applications: {
        Row: {
          applied_at: string | null
          approved_at: string | null
          approved_by: string | null
          attachments: Json | null
          created_at: string | null
          end_date: string
          id: string
          leave_calculation: Json | null
          leave_type: Database["public"]["Enums"]["leave_type"]
          org_id: string
          reason: string
          rejection_reason: string | null
          sandwich_days: number | null
          start_date: string
          status: Database["public"]["Enums"]["leave_status"]
          total_days: number
          updated_at: string | null
          user_id: string
        }
        Insert: {
          applied_at?: string | null
          approved_at?: string | null
          approved_by?: string | null
          attachments?: Json | null
          created_at?: string | null
          end_date: string
          id?: string
          leave_calculation?: Json | null
          leave_type: Database["public"]["Enums"]["leave_type"]
          org_id: string
          reason: string
          rejection_reason?: string | null
          sandwich_days?: number | null
          start_date: string
          status?: Database["public"]["Enums"]["leave_status"]
          total_days: number
          updated_at?: string | null
          user_id: string
        }
        Update: {
          applied_at?: string | null
          approved_at?: string | null
          approved_by?: string | null
          attachments?: Json | null
          created_at?: string | null
          end_date?: string
          id?: string
          leave_calculation?: Json | null
          leave_type?: Database["public"]["Enums"]["leave_type"]
          org_id?: string
          reason?: string
          rejection_reason?: string | null
          sandwich_days?: number | null
          start_date?: string
          status?: Database["public"]["Enums"]["leave_status"]
          total_days?: number
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "leave_applications_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_balance_adjustments: {
        Row: {
          adjusted_by: string
          adjustment_type: string
          created_at: string | null
          days: number
          id: string
          leave_type: string
          new_balance: number | null
          org_id: string
          previous_balance: number | null
          reason: string
          user_id: string
          year: number
        }
        Insert: {
          adjusted_by: string
          adjustment_type: string
          created_at?: string | null
          days: number
          id?: string
          leave_type: string
          new_balance?: number | null
          org_id: string
          previous_balance?: number | null
          reason: string
          user_id: string
          year: number
        }
        Update: {
          adjusted_by?: string
          adjustment_type?: string
          created_at?: string | null
          days?: number
          id?: string
          leave_type?: string
          new_balance?: number | null
          org_id?: string
          previous_balance?: number | null
          reason?: string
          user_id?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "leave_balance_adjustments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      leave_balances: {
        Row: {
          casual_leave_balance: number | null
          casual_leave_limit: number | null
          compensatory_off_balance: number | null
          compensatory_off_limit: number | null
          created_at: string | null
          earned_leave_balance: number | null
          earned_leave_limit: number | null
          id: string
          maternity_leave_balance: number | null
          maternity_leave_limit: number | null
          org_id: string
          paternity_leave_balance: number | null
          paternity_leave_limit: number | null
          sick_leave_balance: number | null
          sick_leave_limit: number | null
          updated_at: string | null
          user_id: string
          year: number
        }
        Insert: {
          casual_leave_balance?: number | null
          casual_leave_limit?: number | null
          compensatory_off_balance?: number | null
          compensatory_off_limit?: number | null
          created_at?: string | null
          earned_leave_balance?: number | null
          earned_leave_limit?: number | null
          id?: string
          maternity_leave_balance?: number | null
          maternity_leave_limit?: number | null
          org_id: string
          paternity_leave_balance?: number | null
          paternity_leave_limit?: number | null
          sick_leave_balance?: number | null
          sick_leave_limit?: number | null
          updated_at?: string | null
          user_id: string
          year: number
        }
        Update: {
          casual_leave_balance?: number | null
          casual_leave_limit?: number | null
          compensatory_off_balance?: number | null
          compensatory_off_limit?: number | null
          created_at?: string | null
          earned_leave_balance?: number | null
          earned_leave_limit?: number | null
          id?: string
          maternity_leave_balance?: number | null
          maternity_leave_limit?: number | null
          org_id?: string
          paternity_leave_balance?: number | null
          paternity_leave_limit?: number | null
          sick_leave_balance?: number | null
          sick_leave_limit?: number | null
          updated_at?: string | null
          user_id?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "leave_balances_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_actuals_snapshot: {
        Row: {
          carry_forward_applied: boolean | null
          created_at: string | null
          deal_contact_ids: string[] | null
          deals_closed: number | null
          frozen_at: string | null
          id: string
          invoiced_invoice_ids: string[] | null
          month: number
          org_id: string
          proposal_contact_ids: string[] | null
          proposals: number | null
          qualified_contact_ids: string[] | null
          qualified_opps: number | null
          received_invoice_ids: string[] | null
          revenue_invoiced: number | null
          revenue_received: number | null
          updated_at: string | null
          year: number
        }
        Insert: {
          carry_forward_applied?: boolean | null
          created_at?: string | null
          deal_contact_ids?: string[] | null
          deals_closed?: number | null
          frozen_at?: string | null
          id?: string
          invoiced_invoice_ids?: string[] | null
          month: number
          org_id: string
          proposal_contact_ids?: string[] | null
          proposals?: number | null
          qualified_contact_ids?: string[] | null
          qualified_opps?: number | null
          received_invoice_ids?: string[] | null
          revenue_invoiced?: number | null
          revenue_received?: number | null
          updated_at?: string | null
          year: number
        }
        Update: {
          carry_forward_applied?: boolean | null
          created_at?: string | null
          deal_contact_ids?: string[] | null
          deals_closed?: number | null
          frozen_at?: string | null
          id?: string
          invoiced_invoice_ids?: string[] | null
          month?: number
          org_id?: string
          proposal_contact_ids?: string[] | null
          proposals?: number | null
          qualified_contact_ids?: string[] | null
          qualified_opps?: number | null
          received_invoice_ids?: string[] | null
          revenue_invoiced?: number | null
          revenue_received?: number | null
          updated_at?: string | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "monthly_actuals_snapshot_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          action_url: string | null
          created_at: string | null
          entity_id: string | null
          entity_type: string | null
          expires_at: string | null
          id: string
          is_read: boolean | null
          message: string
          metadata: Json | null
          org_id: string
          read_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          action_url?: string | null
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          expires_at?: string | null
          id?: string
          is_read?: boolean | null
          message: string
          metadata?: Json | null
          org_id: string
          read_at?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          action_url?: string | null
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          expires_at?: string | null
          id?: string
          is_read?: boolean | null
          message?: string
          metadata?: Json | null
          org_id?: string
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      operation_queue: {
        Row: {
          completed_at: string | null
          created_at: string | null
          error_message: string | null
          id: string
          operation_type: string
          org_id: string
          payload: Json
          priority: number
          result: Json | null
          scheduled_at: string | null
          started_at: string | null
          status: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          operation_type: string
          org_id: string
          payload?: Json
          priority?: number
          result?: Json | null
          scheduled_at?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          operation_type?: string
          org_id?: string
          payload?: Json
          priority?: number
          result?: Json | null
          scheduled_at?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "operation_queue_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operation_queue_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      org_business_hours: {
        Row: {
          created_at: string
          day_of_week: number
          end_time: string
          id: string
          is_enabled: boolean
          org_id: string
          start_time: string
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          day_of_week: number
          end_time: string
          id?: string
          is_enabled?: boolean
          org_id: string
          start_time: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          day_of_week?: number
          end_time?: string
          id?: string
          is_enabled?: boolean
          org_id?: string
          start_time?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_business_hours_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_feature_access: {
        Row: {
          created_at: string | null
          disabled_at: string | null
          enabled_at: string | null
          feature_key: string
          id: string
          is_enabled: boolean | null
          modified_by: string | null
          notes: string | null
          org_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          disabled_at?: string | null
          enabled_at?: string | null
          feature_key: string
          id?: string
          is_enabled?: boolean | null
          modified_by?: string | null
          notes?: string | null
          org_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          disabled_at?: string | null
          enabled_at?: string | null
          feature_key?: string
          id?: string
          is_enabled?: boolean | null
          modified_by?: string | null
          notes?: string | null
          org_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "org_feature_access_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_invites: {
        Row: {
          created_at: string
          email: string | null
          expires_at: string
          id: string
          invite_code: string
          invited_by: string
          org_id: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          used_at: string | null
          used_by: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          expires_at: string
          id?: string
          invite_code: string
          invited_by: string
          org_id: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          used_at?: string | null
          used_by?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          expires_at?: string
          id?: string
          invite_code?: string
          invited_by?: string
          org_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          used_at?: string | null
          used_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "org_invites_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_settings: {
        Row: {
          act_today_only: boolean
          allow_low_recharge: boolean
          calling_windows: Json
          data_retention_days: number
          demo_host_user_id: string | null
          demo_meeting_link: string | null
          demo_reminder_agent_id: string | null
          dialing_active: boolean
          dpo_email: string | null
          dpo_name: string | null
          dpo_phone: string | null
          enforce_wallet_in_trial: boolean
          grievance_email: string | null
          org_id: string
          privacy_policy_url: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          act_today_only?: boolean
          allow_low_recharge?: boolean
          calling_windows?: Json
          data_retention_days?: number
          demo_host_user_id?: string | null
          demo_meeting_link?: string | null
          demo_reminder_agent_id?: string | null
          dialing_active?: boolean
          dpo_email?: string | null
          dpo_name?: string | null
          dpo_phone?: string | null
          enforce_wallet_in_trial?: boolean
          grievance_email?: string | null
          org_id: string
          privacy_policy_url?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          act_today_only?: boolean
          allow_low_recharge?: boolean
          calling_windows?: Json
          data_retention_days?: number
          demo_host_user_id?: string | null
          demo_meeting_link?: string | null
          demo_reminder_agent_id?: string | null
          dialing_active?: boolean
          dpo_email?: string | null
          dpo_name?: string | null
          dpo_phone?: string | null
          enforce_wallet_in_trial?: boolean
          grievance_email?: string | null
          org_id?: string
          privacy_policy_url?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_settings_demo_host_user_id_fkey"
            columns: ["demo_host_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_settings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_subscriptions: {
        Row: {
          billing_cycle_start: string
          billing_period: string
          created_at: string | null
          grace_period_end: string | null
          id: string
          last_payment_date: string | null
          lockout_date: string | null
          monthly_subscription_amount: number
          next_billing_date: string
          one_time_setup_fee: number | null
          org_id: string
          override_by: string | null
          override_reason: string | null
          readonly_period_end: string | null
          subscription_status: string
          suspension_date: string | null
          suspension_override_until: string | null
          suspension_reason: string | null
          updated_at: string | null
          user_count: number
          wallet_alert_level: string
          wallet_alert_sent_at: string | null
          wallet_auto_topup_enabled: boolean | null
          wallet_balance: number
          wallet_last_topup_date: string | null
          wallet_low_alert_threshold: number
          wallet_minimum_balance: number
        }
        Insert: {
          billing_cycle_start: string
          billing_period?: string
          created_at?: string | null
          grace_period_end?: string | null
          id?: string
          last_payment_date?: string | null
          lockout_date?: string | null
          monthly_subscription_amount?: number
          next_billing_date: string
          one_time_setup_fee?: number | null
          org_id: string
          override_by?: string | null
          override_reason?: string | null
          readonly_period_end?: string | null
          subscription_status?: string
          suspension_date?: string | null
          suspension_override_until?: string | null
          suspension_reason?: string | null
          updated_at?: string | null
          user_count?: number
          wallet_alert_level?: string
          wallet_alert_sent_at?: string | null
          wallet_auto_topup_enabled?: boolean | null
          wallet_balance?: number
          wallet_last_topup_date?: string | null
          wallet_low_alert_threshold?: number
          wallet_minimum_balance?: number
        }
        Update: {
          billing_cycle_start?: string
          billing_period?: string
          created_at?: string | null
          grace_period_end?: string | null
          id?: string
          last_payment_date?: string | null
          lockout_date?: string | null
          monthly_subscription_amount?: number
          next_billing_date?: string
          one_time_setup_fee?: number | null
          org_id?: string
          override_by?: string | null
          override_reason?: string | null
          readonly_period_end?: string | null
          subscription_status?: string
          suspension_date?: string | null
          suspension_override_until?: string | null
          suspension_reason?: string | null
          updated_at?: string | null
          user_count?: number
          wallet_alert_level?: string
          wallet_alert_sent_at?: string | null
          wallet_auto_topup_enabled?: boolean | null
          wallet_balance?: number
          wallet_last_topup_date?: string | null
          wallet_low_alert_threshold?: number
          wallet_minimum_balance?: number
        }
        Relationships: [
          {
            foreignKeyName: "organization_subscriptions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          apollo_config: Json | null
          banking_details: Json | null
          created_at: string | null
          id: string
          industry: string | null
          is_internal: boolean
          issuer_address: Json | null
          issuer_company_name: string | null
          issuer_gst_number: string | null
          issuer_pan: string | null
          logo_url: string | null
          max_automation_emails_per_day: number | null
          name: string
          primary_color: string | null
          services_enabled: boolean | null
          settings: Json | null
          slug: string
          subscription_active: boolean | null
          updated_at: string | null
          usage_limits: Json | null
          website: string | null
        }
        Insert: {
          apollo_config?: Json | null
          banking_details?: Json | null
          created_at?: string | null
          id?: string
          industry?: string | null
          is_internal?: boolean
          issuer_address?: Json | null
          issuer_company_name?: string | null
          issuer_gst_number?: string | null
          issuer_pan?: string | null
          logo_url?: string | null
          max_automation_emails_per_day?: number | null
          name: string
          primary_color?: string | null
          services_enabled?: boolean | null
          settings?: Json | null
          slug: string
          subscription_active?: boolean | null
          updated_at?: string | null
          usage_limits?: Json | null
          website?: string | null
        }
        Update: {
          apollo_config?: Json | null
          banking_details?: Json | null
          created_at?: string | null
          id?: string
          industry?: string | null
          is_internal?: boolean
          issuer_address?: Json | null
          issuer_company_name?: string | null
          issuer_gst_number?: string | null
          issuer_pan?: string | null
          logo_url?: string | null
          max_automation_emails_per_day?: number | null
          name?: string
          primary_color?: string | null
          services_enabled?: boolean | null
          settings?: Json | null
          slug?: string
          subscription_active?: boolean | null
          updated_at?: string | null
          usage_limits?: Json | null
          website?: string | null
        }
        Relationships: []
      }
      otp_whatsapp_config: {
        Row: {
          created_at: string | null
          exotel_api_key: string
          exotel_api_token: string
          exotel_sid: string
          exotel_subdomain: string | null
          id: string
          is_active: boolean | null
          updated_at: string | null
          whatsapp_source_number: string
        }
        Insert: {
          created_at?: string | null
          exotel_api_key: string
          exotel_api_token: string
          exotel_sid: string
          exotel_subdomain?: string | null
          id?: string
          is_active?: boolean | null
          updated_at?: string | null
          whatsapp_source_number: string
        }
        Update: {
          created_at?: string | null
          exotel_api_key?: string
          exotel_api_token?: string
          exotel_sid?: string
          exotel_subdomain?: string | null
          id?: string
          is_active?: boolean | null
          updated_at?: string | null
          whatsapp_source_number?: string
        }
        Relationships: []
      }
      outbound_webhook_logs: {
        Row: {
          error_message: string | null
          execution_time_ms: number | null
          id: string
          org_id: string
          payload_sent: Json
          response_body: string | null
          response_status: number | null
          retry_count: number | null
          sent_at: string | null
          succeeded: boolean | null
          trigger_data: Json
          trigger_event: string
          webhook_id: string
        }
        Insert: {
          error_message?: string | null
          execution_time_ms?: number | null
          id?: string
          org_id: string
          payload_sent: Json
          response_body?: string | null
          response_status?: number | null
          retry_count?: number | null
          sent_at?: string | null
          succeeded?: boolean | null
          trigger_data: Json
          trigger_event: string
          webhook_id: string
        }
        Update: {
          error_message?: string | null
          execution_time_ms?: number | null
          id?: string
          org_id?: string
          payload_sent?: Json
          response_body?: string | null
          response_status?: number | null
          retry_count?: number | null
          sent_at?: string | null
          succeeded?: boolean | null
          trigger_data?: Json
          trigger_event?: string
          webhook_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "outbound_webhook_logs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbound_webhook_logs_webhook_id_fkey"
            columns: ["webhook_id"]
            isOneToOne: false
            referencedRelation: "outbound_webhooks"
            referencedColumns: ["id"]
          },
        ]
      }
      outbound_webhooks: {
        Row: {
          authentication_config: Json | null
          authentication_type: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          filter_conditions: Json | null
          headers: Json | null
          http_method: string | null
          id: string
          is_active: boolean | null
          last_executed_at: string | null
          name: string
          org_id: string
          payload_template: Json | null
          retry_config: Json | null
          target_operation: string
          target_table: string
          total_executions: number | null
          total_failures: number | null
          trigger_event: string
          updated_at: string | null
          webhook_url: string
        }
        Insert: {
          authentication_config?: Json | null
          authentication_type?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          filter_conditions?: Json | null
          headers?: Json | null
          http_method?: string | null
          id?: string
          is_active?: boolean | null
          last_executed_at?: string | null
          name: string
          org_id: string
          payload_template?: Json | null
          retry_config?: Json | null
          target_operation?: string
          target_table?: string
          total_executions?: number | null
          total_failures?: number | null
          trigger_event: string
          updated_at?: string | null
          webhook_url: string
        }
        Update: {
          authentication_config?: Json | null
          authentication_type?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          filter_conditions?: Json | null
          headers?: Json | null
          http_method?: string | null
          id?: string
          is_active?: boolean | null
          last_executed_at?: string | null
          name?: string
          org_id?: string
          payload_template?: Json | null
          retry_config?: Json | null
          target_operation?: string
          target_table?: string
          total_executions?: number | null
          total_failures?: number | null
          trigger_event?: string
          updated_at?: string | null
          webhook_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "outbound_webhooks_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_transactions: {
        Row: {
          amount: number
          completed_at: string | null
          created_at: string | null
          failure_reason: string | null
          id: string
          initiated_at: string | null
          initiated_by: string | null
          invoice_id: string | null
          metadata: Json | null
          org_id: string
          payment_method: string | null
          payment_status: string
          razorpay_order_id: string | null
          razorpay_payment_id: string | null
          razorpay_signature: string | null
          transaction_type: string
          updated_at: string | null
        }
        Insert: {
          amount: number
          completed_at?: string | null
          created_at?: string | null
          failure_reason?: string | null
          id?: string
          initiated_at?: string | null
          initiated_by?: string | null
          invoice_id?: string | null
          metadata?: Json | null
          org_id: string
          payment_method?: string | null
          payment_status?: string
          razorpay_order_id?: string | null
          razorpay_payment_id?: string | null
          razorpay_signature?: string | null
          transaction_type: string
          updated_at?: string | null
        }
        Update: {
          amount?: number
          completed_at?: string | null
          created_at?: string | null
          failure_reason?: string | null
          id?: string
          initiated_at?: string | null
          initiated_by?: string | null
          invoice_id?: string | null
          metadata?: Json | null
          org_id?: string
          payment_method?: string | null
          payment_status?: string
          razorpay_order_id?: string | null
          razorpay_payment_id?: string | null
          razorpay_signature?: string | null
          transaction_type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_transactions_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "subscription_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_transactions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      pii_access_log: {
        Row: {
          accessed_at: string
          column_name: string
          contact_id: string | null
          id: string
          org_id: string
          purpose: string
          table_name: string
          user_id: string | null
        }
        Insert: {
          accessed_at?: string
          column_name: string
          contact_id?: string | null
          id?: string
          org_id: string
          purpose?: string
          table_name: string
          user_id?: string | null
        }
        Update: {
          accessed_at?: string
          column_name?: string
          contact_id?: string | null
          id?: string
          org_id?: string
          purpose?: string
          table_name?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pii_access_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_action_queue: {
        Row: {
          action_type: string
          attempts: number
          contact_id: string
          created_at: string
          id: string
          language_code: string
          last_error: string | null
          org_id: string
          processed_at: string | null
          stage_id: string
          status: string
          template_name: string | null
        }
        Insert: {
          action_type: string
          attempts?: number
          contact_id: string
          created_at?: string
          id?: string
          language_code?: string
          last_error?: string | null
          org_id: string
          processed_at?: string | null
          stage_id: string
          status?: string
          template_name?: string | null
        }
        Update: {
          action_type?: string
          attempts?: number
          contact_id?: string
          created_at?: string
          id?: string
          language_code?: string
          last_error?: string | null
          org_id?: string
          processed_at?: string | null
          stage_id?: string
          status?: string
          template_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_action_queue_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_action_queue_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_with_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_action_queue_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_action_queue_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_benchmarks: {
        Row: {
          avg_days_in_stage: number | null
          calculated_at: string
          conversion_rate: number | null
          created_at: string
          id: string
          org_id: string
          period_end: string
          period_start: string
          stage_id: string
          total_contacts_processed: number | null
        }
        Insert: {
          avg_days_in_stage?: number | null
          calculated_at?: string
          conversion_rate?: number | null
          created_at?: string
          id?: string
          org_id: string
          period_end: string
          period_start: string
          stage_id: string
          total_contacts_processed?: number | null
        }
        Update: {
          avg_days_in_stage?: number | null
          calculated_at?: string
          conversion_rate?: number | null
          created_at?: string
          id?: string
          org_id?: string
          period_end?: string
          period_start?: string
          stage_id?: string
          total_contacts_processed?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_benchmarks_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_benchmarks_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_movement_history: {
        Row: {
          contact_id: string
          created_at: string
          days_in_previous_stage: number | null
          from_stage_id: string | null
          id: string
          moved_at: string
          moved_by: string | null
          org_id: string
          to_stage_id: string | null
        }
        Insert: {
          contact_id: string
          created_at?: string
          days_in_previous_stage?: number | null
          from_stage_id?: string | null
          id?: string
          moved_at?: string
          moved_by?: string | null
          org_id: string
          to_stage_id?: string | null
        }
        Update: {
          contact_id?: string
          created_at?: string
          days_in_previous_stage?: number | null
          from_stage_id?: string | null
          id?: string
          moved_at?: string
          moved_by?: string | null
          org_id?: string
          to_stage_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_movement_history_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_movement_history_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_with_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_movement_history_from_stage_id_fkey"
            columns: ["from_stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_movement_history_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_movement_history_to_stage_id_fkey"
            columns: ["to_stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_stage_actions: {
        Row: {
          action_type: string
          agent_id: string | null
          created_at: string
          from_number: string | null
          id: string
          ignore_window: boolean
          is_active: boolean
          language_code: string
          org_id: string
          stage_id: string
          template_name: string | null
        }
        Insert: {
          action_type: string
          agent_id?: string | null
          created_at?: string
          from_number?: string | null
          id?: string
          ignore_window?: boolean
          is_active?: boolean
          language_code?: string
          org_id: string
          stage_id: string
          template_name?: string | null
        }
        Update: {
          action_type?: string
          agent_id?: string | null
          created_at?: string
          from_number?: string | null
          id?: string
          ignore_window?: boolean
          is_active?: boolean
          language_code?: string
          org_id?: string
          stage_id?: string
          template_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_stage_actions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_stage_actions_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: true
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_stages: {
        Row: {
          color: string | null
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          org_id: string
          probability: number | null
          stage_order: number
          updated_at: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          org_id: string
          probability?: number | null
          stage_order: number
          updated_at?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          org_id?: string
          probability?: number | null
          stage_order?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_stages_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_admin_audit_log: {
        Row: {
          action: string
          admin_id: string
          created_at: string
          details: Json | null
          id: string
          target_org_id: string | null
          target_user_id: string | null
        }
        Insert: {
          action: string
          admin_id: string
          created_at?: string
          details?: Json | null
          id?: string
          target_org_id?: string | null
          target_user_id?: string | null
        }
        Update: {
          action?: string
          admin_id?: string
          created_at?: string
          details?: Json | null
          id?: string
          target_org_id?: string | null
          target_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "platform_admin_audit_log_target_org_id_fkey"
            columns: ["target_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_email_sending_list: {
        Row: {
          bounce_count: number
          created_at: string
          email: string
          first_seen_at: string
          id: string
          is_unsubscribed: boolean
          last_bounce_at: string | null
          last_synced_at: string
          name: string | null
          source_type: string
          updated_at: string
        }
        Insert: {
          bounce_count?: number
          created_at?: string
          email: string
          first_seen_at?: string
          id?: string
          is_unsubscribed?: boolean
          last_bounce_at?: string | null
          last_synced_at?: string
          name?: string | null
          source_type: string
          updated_at?: string
        }
        Update: {
          bounce_count?: number
          created_at?: string
          email?: string
          first_seen_at?: string
          id?: string
          is_unsubscribed?: boolean
          last_bounce_at?: string | null
          last_synced_at?: string
          name?: string | null
          source_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          calling_enabled: boolean | null
          created_at: string | null
          designation_id: string | null
          email: string | null
          email_enabled: boolean | null
          first_name: string | null
          id: string
          is_active: boolean
          is_platform_admin: boolean | null
          last_name: string | null
          onboarding_completed: boolean | null
          org_id: string | null
          phone: string | null
          sms_enabled: boolean | null
          updated_at: string | null
          whatsapp_enabled: boolean | null
        }
        Insert: {
          avatar_url?: string | null
          calling_enabled?: boolean | null
          created_at?: string | null
          designation_id?: string | null
          email?: string | null
          email_enabled?: boolean | null
          first_name?: string | null
          id: string
          is_active?: boolean
          is_platform_admin?: boolean | null
          last_name?: string | null
          onboarding_completed?: boolean | null
          org_id?: string | null
          phone?: string | null
          sms_enabled?: boolean | null
          updated_at?: string | null
          whatsapp_enabled?: boolean | null
        }
        Update: {
          avatar_url?: string | null
          calling_enabled?: boolean | null
          created_at?: string | null
          designation_id?: string | null
          email?: string | null
          email_enabled?: boolean | null
          first_name?: string | null
          id?: string
          is_active?: boolean
          is_platform_admin?: boolean | null
          last_name?: string | null
          onboarding_completed?: boolean | null
          org_id?: string | null
          phone?: string | null
          sms_enabled?: boolean | null
          updated_at?: string | null
          whatsapp_enabled?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_designation_id_fkey"
            columns: ["designation_id"]
            isOneToOne: false
            referencedRelation: "designations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      public_otp_verifications: {
        Row: {
          attempts: number | null
          created_at: string | null
          expires_at: string | null
          id: string
          identifier: string
          identifier_type: string
          ip_address: unknown
          max_attempts: number | null
          otp_code: string
          session_id: string | null
          verified_at: string | null
        }
        Insert: {
          attempts?: number | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          identifier: string
          identifier_type: string
          ip_address?: unknown
          max_attempts?: number | null
          otp_code: string
          session_id?: string | null
          verified_at?: string | null
        }
        Update: {
          attempts?: number | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          identifier?: string
          identifier_type?: string
          ip_address?: unknown
          max_attempts?: number | null
          otp_code?: string
          session_id?: string | null
          verified_at?: string | null
        }
        Relationships: []
      }
      rate_limit_log: {
        Row: {
          created_at: string
          id: string
          ip_address: unknown
          operation: string
          org_id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          ip_address?: unknown
          operation: string
          org_id: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          ip_address?: unknown
          operation?: string
          org_id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      recurring_activity_patterns: {
        Row: {
          activity_type: string
          assigned_to: string | null
          contact_id: string | null
          created_at: string | null
          created_by: string | null
          days_of_week: number[]
          description: string | null
          duration_minutes: number | null
          end_date: string
          id: string
          is_task: boolean | null
          meeting_link: string | null
          org_id: string
          priority: string | null
          scheduled_time: string
          start_date: string
          subject: string | null
          updated_at: string | null
        }
        Insert: {
          activity_type: string
          assigned_to?: string | null
          contact_id?: string | null
          created_at?: string | null
          created_by?: string | null
          days_of_week: number[]
          description?: string | null
          duration_minutes?: number | null
          end_date: string
          id?: string
          is_task?: boolean | null
          meeting_link?: string | null
          org_id: string
          priority?: string | null
          scheduled_time: string
          start_date: string
          subject?: string | null
          updated_at?: string | null
        }
        Update: {
          activity_type?: string
          assigned_to?: string | null
          contact_id?: string | null
          created_at?: string | null
          created_by?: string | null
          days_of_week?: number[]
          description?: string | null
          duration_minutes?: number | null
          end_date?: string
          id?: string
          is_task?: boolean | null
          meeting_link?: string | null
          org_id?: string
          priority?: string | null
          scheduled_time?: string
          start_date?: string
          subject?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "recurring_activity_patterns_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_activity_patterns_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_with_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_activity_patterns_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      reporting_hierarchy: {
        Row: {
          created_at: string | null
          designation_id: string
          id: string
          org_id: string
          reports_to_designation_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          designation_id: string
          id?: string
          org_id: string
          reports_to_designation_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          designation_id?: string
          id?: string
          org_id?: string
          reports_to_designation_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reporting_hierarchy_designation_id_fkey"
            columns: ["designation_id"]
            isOneToOne: true
            referencedRelation: "designations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reporting_hierarchy_reports_to_designation_id_fkey"
            columns: ["reports_to_designation_id"]
            isOneToOne: false
            referencedRelation: "designations"
            referencedColumns: ["id"]
          },
        ]
      }
      revenue_goals: {
        Row: {
          created_at: string | null
          created_by: string | null
          goal_amount: number
          id: string
          notes: string | null
          org_id: string
          period_end: string
          period_start: string
          period_type: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          goal_amount?: number
          id?: string
          notes?: string | null
          org_id: string
          period_end: string
          period_start: string
          period_type: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          goal_amount?: number
          id?: string
          notes?: string | null
          org_id?: string
          period_end?: string
          period_start?: string
          period_type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "revenue_goals_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "revenue_goals_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_reports: {
        Row: {
          configuration: Json
          created_at: string
          created_by: string | null
          data_source: string
          description: string | null
          id: string
          is_public: boolean
          name: string
          org_id: string
          updated_at: string
        }
        Insert: {
          configuration?: Json
          created_at?: string
          created_by?: string | null
          data_source: string
          description?: string | null
          id?: string
          is_public?: boolean
          name: string
          org_id: string
          updated_at?: string
        }
        Update: {
          configuration?: Json
          created_at?: string
          created_by?: string | null
          data_source?: string
          description?: string | null
          id?: string
          is_public?: boolean
          name?: string
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_reports_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sdr_test_attempts: {
        Row: {
          auto_score: number | null
          candidate_email: string
          candidate_name: string
          candidate_phone: string | null
          created_at: string | null
          evaluator_notes: string | null
          final_score: number | null
          id: string
          ip_address: string | null
          org_id: string
          started_at: string | null
          submitted_at: string | null
          tab_switch_count: number | null
          time_taken_seconds: number | null
          user_agent: string | null
          verdict: string | null
          years_experience: number | null
        }
        Insert: {
          auto_score?: number | null
          candidate_email: string
          candidate_name: string
          candidate_phone?: string | null
          created_at?: string | null
          evaluator_notes?: string | null
          final_score?: number | null
          id?: string
          ip_address?: string | null
          org_id: string
          started_at?: string | null
          submitted_at?: string | null
          tab_switch_count?: number | null
          time_taken_seconds?: number | null
          user_agent?: string | null
          verdict?: string | null
          years_experience?: number | null
        }
        Update: {
          auto_score?: number | null
          candidate_email?: string
          candidate_name?: string
          candidate_phone?: string | null
          created_at?: string | null
          evaluator_notes?: string | null
          final_score?: number | null
          id?: string
          ip_address?: string | null
          org_id?: string
          started_at?: string | null
          submitted_at?: string | null
          tab_switch_count?: number | null
          time_taken_seconds?: number | null
          user_agent?: string | null
          verdict?: string | null
          years_experience?: number | null
        }
        Relationships: []
      }
      sdr_test_responses: {
        Row: {
          attempt_id: string
          auto_score: number | null
          created_at: string | null
          flagged_for_review: boolean | null
          id: string
          manual_score: number | null
          question_id: string
          response_text: string | null
          section: string | null
          time_spent_seconds: number | null
          updated_at: string | null
        }
        Insert: {
          attempt_id: string
          auto_score?: number | null
          created_at?: string | null
          flagged_for_review?: boolean | null
          id?: string
          manual_score?: number | null
          question_id: string
          response_text?: string | null
          section?: string | null
          time_spent_seconds?: number | null
          updated_at?: string | null
        }
        Update: {
          attempt_id?: string
          auto_score?: number | null
          created_at?: string | null
          flagged_for_review?: boolean | null
          id?: string
          manual_score?: number | null
          question_id?: string
          response_text?: string | null
          section?: string | null
          time_spent_seconds?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sdr_test_responses_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "sdr_test_attempts"
            referencedColumns: ["id"]
          },
        ]
      }
      service_usage_logs: {
        Row: {
          cost: number
          created_at: string | null
          deduction_error: string | null
          id: string
          org_id: string
          quantity: number
          reference_id: string
          service_type: string
          user_id: string | null
          wallet_deducted: boolean | null
          wallet_transaction_id: string | null
        }
        Insert: {
          cost: number
          created_at?: string | null
          deduction_error?: string | null
          id?: string
          org_id: string
          quantity: number
          reference_id: string
          service_type: string
          user_id?: string | null
          wallet_deducted?: boolean | null
          wallet_transaction_id?: string | null
        }
        Update: {
          cost?: number
          created_at?: string | null
          deduction_error?: string | null
          id?: string
          org_id?: string
          quantity?: number
          reference_id?: string
          service_type?: string
          user_id?: string | null
          wallet_deducted?: boolean | null
          wallet_transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "service_usage_logs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_usage_logs_wallet_transaction_id_fkey"
            columns: ["wallet_transaction_id"]
            isOneToOne: false
            referencedRelation: "wallet_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_bulk_campaigns: {
        Row: {
          campaign_name: string
          completed_at: string | null
          created_at: string
          created_by: string | null
          failed_count: number | null
          id: string
          message_content: string
          org_id: string
          pending_count: number | null
          scheduled_at: string | null
          sent_count: number | null
          started_at: string | null
          status: string
          total_recipients: number | null
          updated_at: string
        }
        Insert: {
          campaign_name: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          failed_count?: number | null
          id?: string
          message_content: string
          org_id: string
          pending_count?: number | null
          scheduled_at?: string | null
          sent_count?: number | null
          started_at?: string | null
          status?: string
          total_recipients?: number | null
          updated_at?: string
        }
        Update: {
          campaign_name?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          failed_count?: number | null
          id?: string
          message_content?: string
          org_id?: string
          pending_count?: number | null
          scheduled_at?: string | null
          sent_count?: number | null
          started_at?: string | null
          status?: string
          total_recipients?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_bulk_campaigns_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_bulk_campaigns_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_campaign_recipients: {
        Row: {
          campaign_id: string
          contact_id: string | null
          contact_name: string | null
          created_at: string
          delivered_at: string | null
          error_message: string | null
          id: string
          org_id: string
          phone_number: string
          sent_at: string | null
          status: string
        }
        Insert: {
          campaign_id: string
          contact_id?: string | null
          contact_name?: string | null
          created_at?: string
          delivered_at?: string | null
          error_message?: string | null
          id?: string
          org_id: string
          phone_number: string
          sent_at?: string | null
          status?: string
        }
        Update: {
          campaign_id?: string
          contact_id?: string | null
          contact_name?: string | null
          created_at?: string
          delivered_at?: string | null
          error_message?: string | null
          id?: string
          org_id?: string
          phone_number?: string
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_campaign_recipients_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "sms_bulk_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_campaign_recipients_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_campaign_recipients_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_with_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_campaign_recipients_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_messages: {
        Row: {
          contact_id: string | null
          created_at: string
          delivered_at: string | null
          direction: string
          error_message: string | null
          exotel_sms_id: string | null
          exotel_status_code: string | null
          id: string
          message_content: string
          org_id: string
          phone_number: string
          sent_at: string | null
          sent_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          contact_id?: string | null
          created_at?: string
          delivered_at?: string | null
          direction?: string
          error_message?: string | null
          exotel_sms_id?: string | null
          exotel_status_code?: string | null
          id?: string
          message_content: string
          org_id: string
          phone_number: string
          sent_at?: string | null
          sent_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          contact_id?: string | null
          created_at?: string
          delivered_at?: string | null
          direction?: string
          error_message?: string | null
          exotel_sms_id?: string | null
          exotel_status_code?: string | null
          id?: string
          message_content?: string
          org_id?: string
          phone_number?: string
          sent_at?: string | null
          sent_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_messages_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_messages_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_with_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_messages_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_messages_sent_by_fkey"
            columns: ["sent_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_audit_log: {
        Row: {
          action: string
          created_at: string | null
          id: string
          new_values: Json | null
          old_values: Json | null
          org_id: string | null
          performed_by: string
          reason: string
          target_record_id: string | null
          target_record_type: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          id?: string
          new_values?: Json | null
          old_values?: Json | null
          org_id?: string | null
          performed_by: string
          reason: string
          target_record_id?: string | null
          target_record_type?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          id?: string
          new_values?: Json | null
          old_values?: Json | null
          org_id?: string | null
          performed_by?: string
          reason?: string
          target_record_id?: string | null
          target_record_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscription_audit_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_invoices: {
        Row: {
          base_subscription_amount: number
          billing_period: string | null
          billing_period_end: string
          billing_period_start: string
          created_at: string | null
          due_date: string
          gst_amount: number
          id: string
          invoice_date: string
          invoice_number: string
          invoice_type: string
          org_id: string
          paid_amount: number | null
          paid_at: string | null
          payment_status: string
          prorated_amount: number | null
          setup_fee: number | null
          subtotal: number
          total_amount: number
          updated_at: string | null
          user_count: number
          waive_reason: string | null
          waived_by: string | null
        }
        Insert: {
          base_subscription_amount: number
          billing_period?: string | null
          billing_period_end: string
          billing_period_start: string
          created_at?: string | null
          due_date: string
          gst_amount: number
          id?: string
          invoice_date: string
          invoice_number: string
          invoice_type?: string
          org_id: string
          paid_amount?: number | null
          paid_at?: string | null
          payment_status?: string
          prorated_amount?: number | null
          setup_fee?: number | null
          subtotal: number
          total_amount: number
          updated_at?: string | null
          user_count: number
          waive_reason?: string | null
          waived_by?: string | null
        }
        Update: {
          base_subscription_amount?: number
          billing_period?: string | null
          billing_period_end?: string
          billing_period_start?: string
          created_at?: string | null
          due_date?: string
          gst_amount?: number
          id?: string
          invoice_date?: string
          invoice_number?: string
          invoice_type?: string
          org_id?: string
          paid_amount?: number | null
          paid_at?: string | null
          payment_status?: string
          prorated_amount?: number | null
          setup_fee?: number | null
          subtotal?: number
          total_amount?: number
          updated_at?: string | null
          user_count?: number
          waive_reason?: string | null
          waived_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscription_invoices_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_notifications: {
        Row: {
          created_at: string | null
          email_subject: string
          id: string
          invoice_id: string | null
          metadata: Json | null
          notification_type: string
          org_id: string
          recipient_emails: string[]
          sent_at: string | null
        }
        Insert: {
          created_at?: string | null
          email_subject: string
          id?: string
          invoice_id?: string | null
          metadata?: Json | null
          notification_type: string
          org_id: string
          recipient_emails: string[]
          sent_at?: string | null
        }
        Update: {
          created_at?: string | null
          email_subject?: string
          id?: string
          invoice_id?: string | null
          metadata?: Json | null
          notification_type?: string
          org_id?: string
          recipient_emails?: string[]
          sent_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscription_notifications_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "subscription_invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_notifications_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_pricing: {
        Row: {
          auto_topup_amount: number
          auto_topup_enabled: boolean | null
          call_cost_per_call: number | null
          call_cost_per_minute: number
          created_at: string | null
          created_by: string | null
          effective_from: string
          email_cost_per_unit: number
          gst_percentage: number
          id: string
          is_active: boolean | null
          min_wallet_balance: number
          one_time_setup_cost: number
          per_user_monthly_cost: number
          updated_at: string | null
          whatsapp_cost_per_unit: number
        }
        Insert: {
          auto_topup_amount?: number
          auto_topup_enabled?: boolean | null
          call_cost_per_call?: number | null
          call_cost_per_minute?: number
          created_at?: string | null
          created_by?: string | null
          effective_from?: string
          email_cost_per_unit?: number
          gst_percentage?: number
          id?: string
          is_active?: boolean | null
          min_wallet_balance?: number
          one_time_setup_cost?: number
          per_user_monthly_cost?: number
          updated_at?: string | null
          whatsapp_cost_per_unit?: number
        }
        Update: {
          auto_topup_amount?: number
          auto_topup_enabled?: boolean | null
          call_cost_per_call?: number | null
          call_cost_per_minute?: number
          created_at?: string | null
          created_by?: string | null
          effective_from?: string
          email_cost_per_unit?: number
          gst_percentage?: number
          id?: string
          is_active?: boolean | null
          min_wallet_balance?: number
          one_time_setup_cost?: number
          per_user_monthly_cost?: number
          updated_at?: string | null
          whatsapp_cost_per_unit?: number
        }
        Relationships: []
      }
      support_ticket_comments: {
        Row: {
          comment: string
          created_at: string
          id: string
          is_internal: boolean
          org_id: string
          ticket_id: string
          user_id: string
        }
        Insert: {
          comment: string
          created_at?: string
          id?: string
          is_internal?: boolean
          org_id: string
          ticket_id: string
          user_id: string
        }
        Update: {
          comment?: string
          created_at?: string
          id?: string
          is_internal?: boolean
          org_id?: string
          ticket_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_ticket_comments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_ticket_comments_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_ticket_comments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      support_ticket_escalations: {
        Row: {
          attachments: Json | null
          created_at: string
          escalated_by: string
          escalated_to: string
          id: string
          org_id: string
          remarks: string
          ticket_id: string
        }
        Insert: {
          attachments?: Json | null
          created_at?: string
          escalated_by: string
          escalated_to: string
          id?: string
          org_id: string
          remarks: string
          ticket_id: string
        }
        Update: {
          attachments?: Json | null
          created_at?: string
          escalated_by?: string
          escalated_to?: string
          id?: string
          org_id?: string
          remarks?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_ticket_escalations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_ticket_escalations_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_ticket_history: {
        Row: {
          action: string
          created_at: string | null
          id: string
          new_value: string | null
          old_value: string | null
          org_id: string
          ticket_id: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          id?: string
          new_value?: string | null
          old_value?: string | null
          org_id: string
          ticket_id: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          id?: string
          new_value?: string | null
          old_value?: string | null
          org_id?: string
          ticket_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "support_ticket_history_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_ticket_history_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      support_ticket_notifications: {
        Row: {
          channel: string
          created_at: string
          error_message: string | null
          id: string
          message_preview: string | null
          org_id: string
          recipient: string
          sent_at: string
          status: string
          subject: string | null
          ticket_id: string
        }
        Insert: {
          channel: string
          created_at?: string
          error_message?: string | null
          id?: string
          message_preview?: string | null
          org_id: string
          recipient: string
          sent_at?: string
          status?: string
          subject?: string | null
          ticket_id: string
        }
        Update: {
          channel?: string
          created_at?: string
          error_message?: string | null
          id?: string
          message_preview?: string | null
          org_id?: string
          recipient?: string
          sent_at?: string
          status?: string
          subject?: string | null
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_ticket_notifications_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_ticket_notifications_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          assigned_to: string | null
          attachments: Json | null
          category: string
          client_notified: boolean
          client_notified_at: string | null
          company_name: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          created_by: string
          description: string | null
          due_at: string | null
          id: string
          org_id: string
          priority: string
          resolution_notes: string | null
          resolved_at: string | null
          source: string
          status: string
          subject: string
          ticket_number: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          attachments?: Json | null
          category?: string
          client_notified?: boolean
          client_notified_at?: string | null
          company_name?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          due_at?: string | null
          id?: string
          org_id: string
          priority?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          source?: string
          status?: string
          subject: string
          ticket_number: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          attachments?: Json | null
          category?: string
          client_notified?: boolean
          client_notified_at?: string | null
          company_name?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          due_at?: string | null
          id?: string
          org_id?: string
          priority?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          source?: string
          status?: string
          subject?: string
          ticket_number?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assigned_by: string
          assigned_to: string
          completed_at: string | null
          created_at: string | null
          description: string | null
          due_date: string
          id: string
          morning_reminder_sent: boolean | null
          org_id: string
          pre_action_reminder_sent: boolean | null
          priority: string | null
          recurring_pattern_id: string | null
          remarks: string | null
          reminder_sent: boolean | null
          status: string
          title: string
          updated_at: string | null
        }
        Insert: {
          assigned_by: string
          assigned_to: string
          completed_at?: string | null
          created_at?: string | null
          description?: string | null
          due_date: string
          id?: string
          morning_reminder_sent?: boolean | null
          org_id: string
          pre_action_reminder_sent?: boolean | null
          priority?: string | null
          recurring_pattern_id?: string | null
          remarks?: string | null
          reminder_sent?: boolean | null
          status?: string
          title: string
          updated_at?: string | null
        }
        Update: {
          assigned_by?: string
          assigned_to?: string
          completed_at?: string | null
          created_at?: string | null
          description?: string | null
          due_date?: string
          id?: string
          morning_reminder_sent?: boolean | null
          org_id?: string
          pre_action_reminder_sent?: boolean | null
          priority?: string | null
          recurring_pattern_id?: string | null
          remarks?: string | null
          reminder_sent?: boolean | null
          status?: string
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_recurring_pattern_id_fkey"
            columns: ["recurring_pattern_id"]
            isOneToOne: false
            referencedRelation: "recurring_activity_patterns"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          created_at: string | null
          id: string
          team_id: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          team_id: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          team_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          manager_id: string | null
          name: string
          org_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          manager_id?: string | null
          name: string
          org_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          manager_id?: string | null
          name?: string
          org_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "teams_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_module_usage: {
        Row: {
          created_at: string
          id: string
          last_visited_at: string
          module_icon: string
          module_key: string
          module_name: string
          module_path: string
          org_id: string
          user_id: string
          visit_count: number
        }
        Insert: {
          created_at?: string
          id?: string
          last_visited_at?: string
          module_icon: string
          module_key: string
          module_name: string
          module_path: string
          org_id: string
          user_id: string
          visit_count?: number
        }
        Update: {
          created_at?: string
          id?: string
          last_visited_at?: string
          module_icon?: string
          module_key?: string
          module_name?: string
          module_path?: string
          org_id?: string
          user_id?: string
          visit_count?: number
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean
          org_id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean
          org_id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean
          org_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_status_debug: {
        Row: {
          created_at: string | null
          id: number
          payload: Json | null
        }
        Insert: {
          created_at?: string | null
          id?: never
          payload?: Json | null
        }
        Update: {
          created_at?: string | null
          id?: never
          payload?: Json | null
        }
        Relationships: []
      }
      wallet_transactions: {
        Row: {
          admin_reason: string | null
          amount: number
          balance_after: number
          balance_before: number
          created_at: string | null
          created_by: string | null
          description: string | null
          id: string
          org_id: string
          payment_transaction_id: string | null
          quantity: number | null
          reference_id: string | null
          reference_type: string | null
          transaction_type: string
          unit_cost: number | null
        }
        Insert: {
          admin_reason?: string | null
          amount: number
          balance_after: number
          balance_before: number
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          org_id: string
          payment_transaction_id?: string | null
          quantity?: number | null
          reference_id?: string | null
          reference_type?: string | null
          transaction_type: string
          unit_cost?: number | null
        }
        Update: {
          admin_reason?: string | null
          amount?: number
          balance_after?: number
          balance_before?: number
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          id?: string
          org_id?: string
          payment_transaction_id?: string | null
          quantity?: number | null
          reference_id?: string | null
          reference_type?: string | null
          transaction_type?: string
          unit_cost?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "wallet_transactions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_transactions_payment_transaction_id_fkey"
            columns: ["payment_transaction_id"]
            isOneToOne: false
            referencedRelation: "payment_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_bulk_campaigns: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string | null
          exotel_settings_id: string | null
          failed_count: number
          id: string
          message_content: string
          name: string
          org_id: string
          pending_count: number
          scheduled_at: string | null
          sent_count: number
          started_at: string | null
          status: string
          template_id: string | null
          total_recipients: number
          updated_at: string
          variable_mappings: Json | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          exotel_settings_id?: string | null
          failed_count?: number
          id?: string
          message_content: string
          name: string
          org_id: string
          pending_count?: number
          scheduled_at?: string | null
          sent_count?: number
          started_at?: string | null
          status?: string
          template_id?: string | null
          total_recipients?: number
          updated_at?: string
          variable_mappings?: Json | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          exotel_settings_id?: string | null
          failed_count?: number
          id?: string
          message_content?: string
          name?: string
          org_id?: string
          pending_count?: number
          scheduled_at?: string | null
          sent_count?: number
          started_at?: string | null
          status?: string
          template_id?: string | null
          total_recipients?: number
          updated_at?: string
          variable_mappings?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_bulk_campaigns_exotel_settings_id_fkey"
            columns: ["exotel_settings_id"]
            isOneToOne: false
            referencedRelation: "exotel_settings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_bulk_campaigns_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "communication_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_campaign_recipients: {
        Row: {
          campaign_id: string
          contact_id: string | null
          created_at: string
          custom_data: Json | null
          error_message: string | null
          id: string
          last_retry_at: string | null
          max_retries: number
          message_id: string | null
          next_retry_at: string | null
          phone_number: string
          retry_count: number
          status: string
          updated_at: string
        }
        Insert: {
          campaign_id: string
          contact_id?: string | null
          created_at?: string
          custom_data?: Json | null
          error_message?: string | null
          id?: string
          last_retry_at?: string | null
          max_retries?: number
          message_id?: string | null
          next_retry_at?: string | null
          phone_number: string
          retry_count?: number
          status?: string
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          contact_id?: string | null
          created_at?: string
          custom_data?: Json | null
          error_message?: string | null
          id?: string
          last_retry_at?: string | null
          max_retries?: number
          message_id?: string | null
          next_retry_at?: string | null
          phone_number?: string
          retry_count?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_campaign_recipients_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_bulk_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_campaign_recipients_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_campaign_recipients_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_with_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_campaign_recipients_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_logs: {
        Row: {
          body_params: Json | null
          call_log_id: string | null
          contact_id: string | null
          cost_charged: number
          created_at: string
          delivered_at: string | null
          error_text: string | null
          exotel_msg_sid: string | null
          failed_at: string | null
          id: string
          language_code: string | null
          org_id: string
          read_at: string | null
          sent_at: string | null
          status: string
          template_name: string | null
          to_number: string
        }
        Insert: {
          body_params?: Json | null
          call_log_id?: string | null
          contact_id?: string | null
          cost_charged?: number
          created_at?: string
          delivered_at?: string | null
          error_text?: string | null
          exotel_msg_sid?: string | null
          failed_at?: string | null
          id?: string
          language_code?: string | null
          org_id: string
          read_at?: string | null
          sent_at?: string | null
          status?: string
          template_name?: string | null
          to_number: string
        }
        Update: {
          body_params?: Json | null
          call_log_id?: string | null
          contact_id?: string | null
          cost_charged?: number
          created_at?: string
          delivered_at?: string | null
          error_text?: string | null
          exotel_msg_sid?: string | null
          failed_at?: string | null
          id?: string
          language_code?: string | null
          org_id?: string
          read_at?: string | null
          sent_at?: string | null
          status?: string
          template_name?: string | null
          to_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_logs_call_log_id_fkey"
            columns: ["call_log_id"]
            isOneToOne: false
            referencedRelation: "call_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_logs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_logs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_with_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_logs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_messages: {
        Row: {
          contact_id: string
          conversation_id: string | null
          created_at: string | null
          delivered_at: string | null
          direction: string
          error_message: string | null
          exotel_message_id: string | null
          exotel_status_code: string | null
          gupshup_message_id: string | null
          id: string
          media_type: string | null
          media_url: string | null
          message_content: string
          org_id: string
          phone_number: string
          read_at: string | null
          replied_to_message_id: string | null
          scheduled_at: string | null
          sender_name: string | null
          sent_at: string | null
          sent_by: string | null
          status: string | null
          template_id: string | null
          template_variables: Json | null
        }
        Insert: {
          contact_id: string
          conversation_id?: string | null
          created_at?: string | null
          delivered_at?: string | null
          direction?: string
          error_message?: string | null
          exotel_message_id?: string | null
          exotel_status_code?: string | null
          gupshup_message_id?: string | null
          id?: string
          media_type?: string | null
          media_url?: string | null
          message_content: string
          org_id: string
          phone_number: string
          read_at?: string | null
          replied_to_message_id?: string | null
          scheduled_at?: string | null
          sender_name?: string | null
          sent_at?: string | null
          sent_by?: string | null
          status?: string | null
          template_id?: string | null
          template_variables?: Json | null
        }
        Update: {
          contact_id?: string
          conversation_id?: string | null
          created_at?: string | null
          delivered_at?: string | null
          direction?: string
          error_message?: string | null
          exotel_message_id?: string | null
          exotel_status_code?: string | null
          gupshup_message_id?: string | null
          id?: string
          media_type?: string | null
          media_url?: string | null
          message_content?: string
          org_id?: string
          phone_number?: string
          read_at?: string | null
          replied_to_message_id?: string | null
          scheduled_at?: string | null
          sender_name?: string | null
          sent_at?: string | null
          sent_by?: string | null
          status?: string | null
          template_id?: string | null
          template_variables?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_messages_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts_with_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_replied_to_message_id_fkey"
            columns: ["replied_to_message_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "communication_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_settings: {
        Row: {
          app_name: string
          created_at: string | null
          gupshup_api_key: string
          id: string
          is_active: boolean | null
          org_id: string
          updated_at: string | null
          webhook_secret: string | null
          whatsapp_source_number: string
        }
        Insert: {
          app_name: string
          created_at?: string | null
          gupshup_api_key: string
          id?: string
          is_active?: boolean | null
          org_id: string
          updated_at?: string | null
          webhook_secret?: string | null
          whatsapp_source_number: string
        }
        Update: {
          app_name?: string
          created_at?: string | null
          gupshup_api_key?: string
          id?: string
          is_active?: boolean | null
          org_id?: string
          updated_at?: string | null
          webhook_secret?: string | null
          whatsapp_source_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_settings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      contact_latest_disposition: {
        Row: {
          call_log_id: string | null
          contact_id: string | null
          disposition_category: string | null
          disposition_id: string | null
          disposition_name: string | null
          dispositioned_at: string | null
          org_id: string | null
        }
        Relationships: []
      }
      contacts_with_stages: {
        Row: {
          assigned_to: string | null
          company: string | null
          created_at: string | null
          email: string | null
          first_name: string | null
          id: string | null
          job_title: string | null
          last_name: string | null
          org_id: string | null
          phone: string | null
          pipeline_stage_id: string | null
          stage_name: string | null
          stage_order: number | null
          status: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_pipeline_stage_id_fkey"
            columns: ["pipeline_stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      aggregate_automation_performance_daily: {
        Args: { _date: string }
        Returns: undefined
      }
      anonymize_expired_contacts: {
        Args: { p_limit?: number; p_org_id: string }
        Returns: number
      }
      apply_name_hi: {
        Args: { p_ids: string[]; p_names: string[] }
        Returns: number
      }
      bulk_delete_verified: {
        Args: {
          _org_id: string
          _record_ids: string[]
          _table_name: string
          _user_id: string
        }
        Returns: Json
      }
      calculate_monthly_amount: { Args: { _org_id: string }; Returns: number }
      calculate_sandwich_leave_days: {
        Args: { p_end_date: string; p_start_date: string; p_user_id?: string }
        Returns: Json
      }
      can_create_import_job: {
        Args: { _org_id: string; _user_id: string }
        Returns: boolean
      }
      capture_carry_forward_optimized: {
        Args: { _org_id: string; _reference_year: number }
        Returns: Json
      }
      check_and_increment_daily_limit: {
        Args: { _contact_id: string; _max_per_day: number; _org_id: string }
        Returns: boolean
      }
      check_and_update_subscription_status: {
        Args: { _org_id: string }
        Returns: undefined
      }
      check_circular_dependency: {
        Args: { _depends_on_rule_id: string; _rule_id: string }
        Returns: boolean
      }
      check_connector_rate_limit: {
        Args: { _form_id: string; _limit: number }
        Returns: boolean
      }
      check_inactive_contacts: { Args: never; Returns: undefined }
      claim_edu_punches: {
        Args: { _limit?: number }
        Returns: {
          attempts: number
          claimed_at: string | null
          created_at: string | null
          device_id: string
          direction: string
          id: string
          last_error: string | null
          org_id: string
          person_type: string
          photo: string | null
          punch_time: string
          pushed_at: string | null
          source: string
          student_id: string | null
          sync_status: string
          teacher_id: string | null
          upsmf_entry_id: number | null
          upsmf_identifier: string
        }[]
        SetofOptions: {
          from: "*"
          to: "edu_attendance_punches"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      cleanup_orphaned_profile: {
        Args: { user_id: string }
        Returns: undefined
      }
      contact_ai_call_stats: {
        Args: { p_contact_ids: string[] }
        Returns: {
          attempts: number
          connected: number
          contact_id: string
        }[]
      }
      create_default_call_dispositions: {
        Args: { _org_id: string }
        Returns: undefined
      }
      create_default_pipeline_stages: {
        Args: { _org_id: string }
        Returns: undefined
      }
      create_organization_for_user: {
        Args: { p_org_name: string; p_org_slug: string; p_user_id: string }
        Returns: string
      }
      credit_wallet_funds: {
        Args: { p_amount: number; p_org: string }
        Returns: number
      }
      cron_aggregate_automation_performance: { Args: never; Returns: undefined }
      decrypt_pii: { Args: { ciphertext: string }; Returns: string }
      deduct_from_wallet: {
        Args: {
          _amount: number
          _org_id: string
          _quantity: number
          _reference_id: string
          _service_type: string
          _unit_cost: number
          _user_id: string
        }
        Returns: Json
      }
      delete_user_data: { Args: { user_email: string }; Returns: undefined }
      designation_has_feature_access: {
        Args: {
          _designation_id: string
          _feature_key: string
          _permission?: string
        }
        Returns: boolean
      }
      encrypt_pii: { Args: { plaintext: string }; Returns: string }
      erase_contact_pii: {
        Args: { p_contact_id: string; p_request_id?: string }
        Returns: Json
      }
      generate_api_key: { Args: never; Returns: string }
      generate_unique_slug: { Args: { base_slug: string }; Returns: string }
      generate_webhook_token: { Args: never; Returns: string }
      get_active_pricing: {
        Args: never
        Returns: {
          auto_topup_amount: number
          call_cost_per_call: number
          call_cost_per_minute: number
          email_cost_per_unit: number
          gst_percentage: number
          min_wallet_balance: number
          one_time_setup_cost: number
          per_user_monthly_cost: number
          whatsapp_cost_per_unit: number
        }[]
      }
      get_activity_trends: {
        Args: { p_days?: number; p_org_id: string }
        Returns: {
          activity_count: number
          activity_date: string
          activity_type: string
        }[]
      }
      get_ai_agent_analytics: {
        Args: { p_days?: number; p_org_id?: string }
        Returns: {
          avg_talk_sec: number
          busy: number
          callbacks: number
          decision_maker: number
          demos: number
          dnc: number
          failed: number
          in_flight: number
          interested: number
          no_answer: number
          not_connected: number
          not_interested: number
          not_qualified: number
          picked_up: number
          product: string
          reached: number
          total_dialed: number
        }[]
      }
      get_ai_call_candidates:
        | {
            Args: { p_limit: number; p_org: string }
            Returns: {
              company: string
              first_name: string
              id: string
              job_title: string
              last_name: string
              phone: string
            }[]
          }
        | {
            Args: { p_limit: number; p_org: string; p_owner?: string }
            Returns: {
              company: string
              first_name: string
              id: string
              job_title: string
              last_name: string
              phone: string
            }[]
          }
      get_contact_decrypted: { Args: { p_contact_id: string }; Returns: Json }
      get_contacts_needing_translit: {
        Args: { p_limit: number; p_org: string }
        Returns: {
          id: string
          name_en: string
        }[]
      }
      get_dashboard_stats: { Args: { p_org_id: string }; Returns: Json }
      get_demo_stats_this_month: {
        Args: { p_org_id: string }
        Returns: {
          demos_done: number
          demos_upcoming: number
        }[]
      }
      get_iedup_beneficiaries: {
        Args: {
          p_disposition?: string
          p_from?: string
          p_limit: number
          p_offset: number
          p_org: string
          p_stage_id?: string
          p_status?: string
          p_to?: string
        }
        Returns: {
          action: string
          attempts: number
          connected: number
          created_at: string
          disposition: string
          do_not_call: boolean
          first_name: string
          id: string
          last_call_at: string
          last_name: string
          name_hi: string
          phone: string
          pipeline_stage_id: string
          status: string
          total_count: number
        }[]
      }
      get_monthly_actuals_optimized: {
        Args: { _org_id: string; _year: number }
        Returns: {
          deal_contact_ids: string[]
          deals: number
          invoiced: number
          invoiced_invoice_ids: string[]
          month: number
          proposal_contact_ids: string[]
          proposals: number
          qualified: number
          qualified_contact_ids: string[]
          received: number
          received_invoice_ids: string[]
        }[]
      }
      get_optimal_send_time: {
        Args: { _contact_id: string; _default_hour?: number; _org_id: string }
        Returns: Json
      }
      get_org_statistics: { Args: { p_org_id: string }; Returns: Json }
      get_orphaned_profiles: {
        Args: never
        Returns: {
          created_at: string
          email: string
          first_name: string
          last_name: string
          user_id: string
        }[]
      }
      get_pipeline_distribution: {
        Args: { p_org_id: string }
        Returns: {
          contact_count: number
          stage_name: string
        }[]
      }
      get_pipeline_performance_report: {
        Args: { p_org_id: string }
        Returns: {
          contact_count: number
          stage_color: string
          stage_id: string
          stage_name: string
          stage_order: number
        }[]
      }
      get_platform_admin_stats: { Args: never; Returns: Json }
      get_reporting_chain: {
        Args: { p_designation_id: string }
        Returns: {
          designation_id: string
          level: number
        }[]
      }
      get_rule_execution_order: {
        Args: { _org_id: string }
        Returns: {
          execution_level: number
          rule_id: string
        }[]
      }
      get_sales_performance_report: {
        Args: { p_org_id: string; p_start_date: string }
        Returns: {
          conversion_rate: number
          deals_won: number
          total_calls: number
          total_contacts: number
          total_emails: number
          total_meetings: number
          user_id: string
          user_name: string
        }[]
      }
      get_subordinates: {
        Args: { p_designation_id: string }
        Returns: {
          designation_id: string
          level: number
        }[]
      }
      get_unified_inbox: {
        Args: { p_limit?: number; p_org_id: string }
        Returns: {
          channel: string
          contact_id: string
          contact_name: string
          conversation_id: string
          direction: string
          email_address: string
          id: string
          is_read: boolean
          phone_number: string
          preview: string
          sender_name: string
          sent_at: string
        }[]
      }
      get_user_org_id: { Args: { _user_id: string }; Returns: string }
      get_user_org_id_unlocked: { Args: { _user_id: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_automation_cooldown: {
        Args: { _contact_id: string; _org_id: string; _rule_id: string }
        Returns: undefined
      }
      increment_automation_rule_stats: {
        Args: { _rule_id: string; _stat_type: string }
        Returns: undefined
      }
      increment_campaign_stats: {
        Args: {
          p_campaign_id: string
          p_failed_increment?: number
          p_pending_increment?: number
          p_sent_increment?: number
        }
        Returns: undefined
      }
      increment_email_campaign_stats: {
        Args: {
          p_campaign_id: string
          p_failed_increment?: number
          p_pending_increment?: number
          p_sent_increment?: number
        }
        Returns: undefined
      }
      increment_sms_campaign_stats: {
        Args: {
          p_campaign_id: string
          p_failed_increment?: number
          p_pending_increment?: number
          p_sent_increment?: number
        }
        Returns: undefined
      }
      is_admin_of_conversation: {
        Args: { check_user_id: string; conv_id: string }
        Returns: boolean
      }
      is_current_org_locked: { Args: never; Returns: boolean }
      is_email_suppressed: {
        Args: { _email: string; _org_id: string }
        Returns: boolean
      }
      is_email_unsubscribed: {
        Args: { _email: string; _org_id: string }
        Returns: boolean
      }
      is_feature_enabled_for_org: {
        Args: { _feature_key: string; _org_id: string }
        Returns: boolean
      }
      is_org_locked: { Args: { _org_id: string }; Returns: boolean }
      is_participant_in_conversation: {
        Args: { check_user_id: string; conv_id: string }
        Returns: boolean
      }
      is_platform_admin: { Args: { _user_id: string }; Returns: boolean }
      is_within_business_hours: {
        Args: { _check_time: string; _org_id: string }
        Returns: boolean
      }
      manage_webhook_trigger: {
        Args: { p_action: string; p_operation: string; p_table_name: string }
        Returns: undefined
      }
      mark_automation_conversion: {
        Args: {
          _conversion_type: string
          _conversion_value?: number
          _execution_id: string
        }
        Returns: undefined
      }
      merge_clients_atomic: {
        Args: {
          _duplicate_client_ids: string[]
          _org_id: string
          _primary_client_id: string
        }
        Returns: Json
      }
      process_bulk_import_batch: {
        Args: {
          p_import_id: string
          p_org_id: string
          p_table_name: string
          p_user_id: string
        }
        Returns: Json
      }
      process_time_based_triggers: { Args: never; Returns: undefined }
      refresh_contacts_with_stages: { Args: never; Returns: undefined }
      reserve_wallet_funds: {
        Args: { p_amount: number; p_floor: number; p_org: string }
        Returns: number
      }
      revert_bulk_import: {
        Args: { p_import_id: string; p_org_id: string }
        Returns: Json
      }
      sync_platform_email_list: { Args: never; Returns: undefined }
      trigger_retry_failed_whatsapp: { Args: never; Returns: undefined }
      update_lead_score: {
        Args: {
          _contact_id: string
          _org_id: string
          _reason: string
          _score_delta: number
        }
        Returns: undefined
      }
    }
    Enums: {
      app_role:
        | "super_admin"
        | "admin"
        | "sales_manager"
        | "sales_agent"
        | "support_manager"
        | "support_agent"
        | "analyst"
      import_status:
        | "pending"
        | "processing"
        | "completed"
        | "failed"
        | "partial"
        | "cancelled"
        | "reverted"
      leave_status: "pending" | "approved" | "rejected" | "cancelled"
      leave_type:
        | "sick_leave"
        | "casual_leave"
        | "earned_leave"
        | "unpaid_leave"
        | "compensatory_off"
        | "maternity_leave"
        | "paternity_leave"
      regularization_status: "pending" | "approved" | "rejected"
      regularization_type:
        | "forgot_signin"
        | "forgot_signout"
        | "time_correction"
        | "location_issue"
        | "other"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: [
        "super_admin",
        "admin",
        "sales_manager",
        "sales_agent",
        "support_manager",
        "support_agent",
        "analyst",
      ],
      import_status: [
        "pending",
        "processing",
        "completed",
        "failed",
        "partial",
        "cancelled",
        "reverted",
      ],
      leave_status: ["pending", "approved", "rejected", "cancelled"],
      leave_type: [
        "sick_leave",
        "casual_leave",
        "earned_leave",
        "unpaid_leave",
        "compensatory_off",
        "maternity_leave",
        "paternity_leave",
      ],
      regularization_status: ["pending", "approved", "rejected"],
      regularization_type: [
        "forgot_signin",
        "forgot_signout",
        "time_correction",
        "location_issue",
        "other",
      ],
    },
  },
} as const
