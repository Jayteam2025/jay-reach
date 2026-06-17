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
  public: {
    Tables: {
      api_rate_limits: {
        Row: {
          created_at: string | null
          endpoint_category: string
          id: string
          identifier: string
          identifier_type: string
          request_count: number | null
          window_start: string
        }
        Insert: {
          created_at?: string | null
          endpoint_category: string
          id?: string
          identifier: string
          identifier_type: string
          request_count?: number | null
          window_start?: string
        }
        Update: {
          created_at?: string | null
          endpoint_category?: string
          id?: string
          identifier?: string
          identifier_type?: string
          request_count?: number | null
          window_start?: string
        }
        Relationships: []
      }
      bouncer_jobs: {
        Row: {
          job_id: string
          profile_ids: string[]
          received_at: string | null
          sent_at: string
          status: string
          webhook_payload: Json | null
        }
        Insert: {
          job_id: string
          profile_ids: string[]
          received_at?: string | null
          sent_at?: string
          status?: string
          webhook_payload?: Json | null
        }
        Update: {
          job_id?: string
          profile_ids?: string[]
          received_at?: string | null
          sent_at?: string
          status?: string
          webhook_payload?: Json | null
        }
        Relationships: []
      }
      catch_all_domains: {
        Row: {
          detected_at: string
          domain: string
          reoon_raw: Json | null
        }
        Insert: {
          detected_at?: string
          domain: string
          reoon_raw?: Json | null
        }
        Update: {
          detected_at?: string
          domain?: string
          reoon_raw?: Json | null
        }
        Relationships: []
      }
      daily_reoon_usage: {
        Row: {
          daily_cap: number
          updated_at: string
          usage_date: string
          used_today: number
        }
        Insert: {
          daily_cap?: number
          updated_at?: string
          usage_date: string
          used_today?: number
        }
        Update: {
          daily_cap?: number
          updated_at?: string
          usage_date?: string
          used_today?: number
        }
        Relationships: []
      }
      domain_email_patterns: {
        Row: {
          confidence: number
          detected_at: string
          domain: string
          downgraded_at: string | null
          downgraded_reason: string | null
          empirical_bounces: number
          empirical_replies: number
          empirical_sends: number
          hits: number
          pattern: string
          sample_count: number
          secondary_hits: number | null
          secondary_pattern: string | null
          tier: string
          updated_at: string
        }
        Insert: {
          confidence: number
          detected_at?: string
          domain: string
          downgraded_at?: string | null
          downgraded_reason?: string | null
          empirical_bounces?: number
          empirical_replies?: number
          empirical_sends?: number
          hits: number
          pattern: string
          sample_count: number
          secondary_hits?: number | null
          secondary_pattern?: string | null
          tier: string
          updated_at?: string
        }
        Update: {
          confidence?: number
          detected_at?: string
          domain?: string
          downgraded_at?: string | null
          downgraded_reason?: string | null
          empirical_bounces?: number
          empirical_replies?: number
          empirical_sends?: number
          hits?: number
          pattern?: string
          sample_count?: number
          secondary_hits?: number | null
          secondary_pattern?: string | null
          tier?: string
          updated_at?: string
        }
        Relationships: []
      }
      edge_function_logs: {
        Row: {
          created_at: string | null
          function_name: string
          id: string
          message: string | null
          metadata: Json | null
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          function_name: string
          id?: string
          message?: string | null
          metadata?: Json | null
          status: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          function_name?: string
          id?: string
          message?: string | null
          metadata?: Json | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "edge_function_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      email_verification_cache: {
        Row: {
          checked_at: string
          email: string
          reoon_raw: Json | null
          source: string
          status: string
        }
        Insert: {
          checked_at?: string
          email: string
          reoon_raw?: Json | null
          source: string
          status: string
        }
        Update: {
          checked_at?: string
          email?: string
          reoon_raw?: Json | null
          source?: string
          status?: string
        }
        Relationships: []
      }
      enrichment_cache: {
        Row: {
          cache_key: string
          cache_type: string
          created_at: string | null
          data: Json
          expires_at: string
          id: string
        }
        Insert: {
          cache_key: string
          cache_type: string
          created_at?: string | null
          data?: Json
          expires_at: string
          id?: string
        }
        Update: {
          cache_key?: string
          cache_type?: string
          created_at?: string | null
          data?: Json
          expires_at?: string
          id?: string
        }
        Relationships: []
      }
      icp_personas: {
        Row: {
          channels_config: Json
          channels_priority: string[]
          created_at: string
          created_by: string | null
          department_patterns: string[]
          description: string | null
          enrichment_caps: Json
          exclude_titles: string[]
          icon: string | null
          id: string
          is_active: boolean
          is_default: boolean
          job_title_keywords: string[]
          label: string
          persona_match_threshold: number
          persona_scoring_prompt: string
          search_strategy: string
          seniority_levels: string[]
          slug: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          channels_config?: Json
          channels_priority?: string[]
          created_at?: string
          created_by?: string | null
          department_patterns?: string[]
          description?: string | null
          enrichment_caps?: Json
          exclude_titles?: string[]
          icon?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          job_title_keywords?: string[]
          label: string
          persona_match_threshold?: number
          persona_scoring_prompt: string
          search_strategy?: string
          seniority_levels?: string[]
          slug: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          channels_config?: Json
          channels_priority?: string[]
          created_at?: string
          created_by?: string | null
          department_patterns?: string[]
          description?: string | null
          enrichment_caps?: Json
          exclude_titles?: string[]
          icon?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          job_title_keywords?: string[]
          label?: string
          persona_match_threshold?: number
          persona_scoring_prompt?: string
          search_strategy?: string
          seniority_levels?: string[]
          slug?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "icp_profiles_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      pattern_audit_events: {
        Row: {
          domain: string
          email: string
          email_source: string
          event_type: string
          event_value: string | null
          fullenrich_status: string | null
          id: string
          occurred_at: string
          pattern_confidence: number | null
          pattern_id: string | null
          prospect_id: string
        }
        Insert: {
          domain: string
          email: string
          email_source: string
          event_type: string
          event_value?: string | null
          fullenrich_status?: string | null
          id?: string
          occurred_at?: string
          pattern_confidence?: number | null
          pattern_id?: string | null
          prospect_id: string
        }
        Update: {
          domain?: string
          email?: string
          email_source?: string
          event_type?: string
          event_value?: string | null
          fullenrich_status?: string | null
          id?: string
          occurred_at?: string
          pattern_confidence?: number | null
          pattern_id?: string | null
          prospect_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pattern_audit_events_prospect_id_fkey"
            columns: ["prospect_id"]
            isOneToOne: false
            referencedRelation: "prospect_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_fullenrich_bulks: {
        Row: {
          created_at: string
          enrichment_id: string
          received_at: string | null
          webhook_payload: Json | null
        }
        Insert: {
          created_at?: string
          enrichment_id: string
          received_at?: string | null
          webhook_payload?: Json | null
        }
        Update: {
          created_at?: string
          enrichment_id?: string
          received_at?: string | null
          webhook_payload?: Json | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          current_plan: string
          email: string | null
          first_name: string | null
          id: string
          last_name: string | null
          role: string
        }
        Insert: {
          created_at?: string
          current_plan?: string
          email?: string | null
          first_name?: string | null
          id: string
          last_name?: string | null
          role?: string
        }
        Update: {
          created_at?: string
          current_plan?: string
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          role?: string
        }
        Relationships: []
      }
      prospect_actions: {
        Row: {
          action_type: string
          channel: string
          company_group_id: string
          created_at: string
          id: string
          metadata: Json | null
          prospect_id: string
          workspace_id: string
        }
        Insert: {
          action_type: string
          channel: string
          company_group_id: string
          created_at?: string
          id?: string
          metadata?: Json | null
          prospect_id: string
          workspace_id: string
        }
        Update: {
          action_type?: string
          channel?: string
          company_group_id?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          prospect_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospect_actions_prospect_id_fkey"
            columns: ["prospect_id"]
            isOneToOne: false
            referencedRelation: "prospect_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospect_actions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      prospect_batches: {
        Row: {
          batch_id: string
          batch_type: string
          error: string | null
          failed_count: number | null
          id: string
          last_polled_at: string | null
          processed_at: string | null
          processed_count: number | null
          run_id: string
          status: string
          submitted_at: string
          total: number | null
          workspace_id: string
        }
        Insert: {
          batch_id: string
          batch_type: string
          error?: string | null
          failed_count?: number | null
          id?: string
          last_polled_at?: string | null
          processed_at?: string | null
          processed_count?: number | null
          run_id: string
          status?: string
          submitted_at?: string
          total?: number | null
          workspace_id: string
        }
        Update: {
          batch_id?: string
          batch_type?: string
          error?: string | null
          failed_count?: number | null
          id?: string
          last_polled_at?: string | null
          processed_at?: string | null
          processed_count?: number | null
          run_id?: string
          status?: string
          submitted_at?: string
          total?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospect_batches_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      prospect_crm_detections: {
        Row: {
          attempts: number
          company_group_id: string
          created_at: string
          crm_confidence: string
          crm_name: string | null
          crm_signals: Json
          detected_at: string | null
          detection_status: string
          domain: string | null
          domain_source: string | null
          error: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          attempts?: number
          company_group_id: string
          created_at?: string
          crm_confidence?: string
          crm_name?: string | null
          crm_signals?: Json
          detected_at?: string | null
          detection_status?: string
          domain?: string | null
          domain_source?: string | null
          error?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          attempts?: number
          company_group_id?: string
          created_at?: string
          crm_confidence?: string
          crm_name?: string | null
          crm_signals?: Json
          detected_at?: string | null
          detection_status?: string
          domain?: string | null
          domain_source?: string | null
          error?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospect_crm_detections_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      prospect_data_access_logs: {
        Row: {
          action: string
          admin_id: string
          created_at: string | null
          id: string
          metadata: Json | null
          prospect_ids: string[]
          workspace_id: string
        }
        Insert: {
          action: string
          admin_id: string
          created_at?: string | null
          id?: string
          metadata?: Json | null
          prospect_ids: string[]
          workspace_id: string
        }
        Update: {
          action?: string
          admin_id?: string
          created_at?: string | null
          id?: string
          metadata?: Json | null
          prospect_ids?: string[]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospect_data_access_logs_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospect_data_access_logs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      prospect_enrichment_job_items: {
        Row: {
          attempts: number
          claimed_at: string | null
          completed_at: string | null
          created_at: string
          error: string | null
          id: string
          job_id: string
          signal_id: string
          status: string
          workspace_id: string
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          job_id: string
          signal_id: string
          status?: string
          workspace_id: string
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          completed_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          job_id?: string
          signal_id?: string
          status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospect_enrichment_job_items_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "prospect_enrichment_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospect_enrichment_job_items_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "prospect_signals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospect_enrichment_job_items_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      prospect_enrichment_jobs: {
        Row: {
          completed: number
          completed_at: string | null
          concurrency: number
          created_at: string
          failed: number
          id: string
          status: string
          total: number
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          completed?: number
          completed_at?: string | null
          concurrency?: number
          created_at?: string
          failed?: number
          id?: string
          status?: string
          total?: number
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          completed?: number
          completed_at?: string | null
          concurrency?: number
          created_at?: string
          failed?: number
          id?: string
          status?: string
          total?: number
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospect_enrichment_jobs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      prospect_icp_filters: {
        Row: {
          created_at: string | null
          criteria: Json
          id: string
          is_active: boolean | null
          name: string
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string | null
          criteria: Json
          id?: string
          is_active?: boolean | null
          name: string
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string | null
          criteria?: Json
          id?: string
          is_active?: boolean | null
          name?: string
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospect_icp_filters_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      prospect_imports: {
        Row: {
          committed_at: string | null
          created_at: string
          extracted_text_cache: string | null
          id: string
          mapping_used: Json
          rows_detected: number
          rows_failed: number
          rows_imported: number
          rows_skipped_duplicate: number
          rows_skipped_user: number
          source_file_hash: string | null
          source_file_path: string | null
          source_file_size_bytes: number | null
          source_filename: string
          source_format: string
          source_sheet_name: string | null
          user_id: string
          workspace_id: string
        }
        Insert: {
          committed_at?: string | null
          created_at?: string
          extracted_text_cache?: string | null
          id?: string
          mapping_used?: Json
          rows_detected?: number
          rows_failed?: number
          rows_imported?: number
          rows_skipped_duplicate?: number
          rows_skipped_user?: number
          source_file_hash?: string | null
          source_file_path?: string | null
          source_file_size_bytes?: number | null
          source_filename: string
          source_format: string
          source_sheet_name?: string | null
          user_id: string
          workspace_id: string
        }
        Update: {
          committed_at?: string | null
          created_at?: string
          extracted_text_cache?: string | null
          id?: string
          mapping_used?: Json
          rows_detected?: number
          rows_failed?: number
          rows_imported?: number
          rows_skipped_duplicate?: number
          rows_skipped_user?: number
          source_file_hash?: string | null
          source_file_path?: string | null
          source_file_size_bytes?: number | null
          source_filename?: string
          source_format?: string
          source_sheet_name?: string | null
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospect_imports_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospect_imports_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      prospect_message_templates: {
        Row: {
          body: string
          channel: string
          icebreaker_template: string
          id: string
          is_active: boolean
          opener_variants: string[]
          persona_id: string
          subject: string | null
          subject_variants: string[]
          updated_at: string
          updated_by: string | null
          version: number
          workspace_id: string
        }
        Insert: {
          body: string
          channel: string
          icebreaker_template?: string
          id?: string
          is_active?: boolean
          opener_variants?: string[]
          persona_id: string
          subject?: string | null
          subject_variants?: string[]
          updated_at?: string
          updated_by?: string | null
          version?: number
          workspace_id: string
        }
        Update: {
          body?: string
          channel?: string
          icebreaker_template?: string
          id?: string
          is_active?: boolean
          opener_variants?: string[]
          persona_id?: string
          subject?: string | null
          subject_variants?: string[]
          updated_at?: string
          updated_by?: string | null
          version?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospect_message_templates_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "icp_personas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospect_message_templates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      prospect_messages: {
        Row: {
          body: string
          channel: string
          created_at: string | null
          icebreaker: string | null
          id: string
          llm_model: string | null
          llm_prompt_hash: string | null
          persona_id: string
          prospect_id: string
          replied_at: string | null
          scheduled_at: string | null
          sent_at: string | null
          sequence_id: string | null
          status: string
          step_position: number | null
          subject: string | null
          template_id: string | null
          template_version: number | null
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          body: string
          channel: string
          created_at?: string | null
          icebreaker?: string | null
          id?: string
          llm_model?: string | null
          llm_prompt_hash?: string | null
          persona_id: string
          prospect_id: string
          replied_at?: string | null
          scheduled_at?: string | null
          sent_at?: string | null
          sequence_id?: string | null
          status?: string
          step_position?: number | null
          subject?: string | null
          template_id?: string | null
          template_version?: number | null
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          body?: string
          channel?: string
          created_at?: string | null
          icebreaker?: string | null
          id?: string
          llm_model?: string | null
          llm_prompt_hash?: string | null
          persona_id?: string
          prospect_id?: string
          replied_at?: string | null
          scheduled_at?: string | null
          sent_at?: string | null
          sequence_id?: string | null
          status?: string
          step_position?: number | null
          subject?: string | null
          template_id?: string | null
          template_version?: number | null
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospect_messages_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "icp_personas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospect_messages_prospect_id_fkey"
            columns: ["prospect_id"]
            isOneToOne: false
            referencedRelation: "prospect_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospect_messages_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "prospect_sequences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospect_messages_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "prospect_message_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospect_messages_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      prospect_profiles: {
        Row: {
          bouncer_checked_at: string | null
          bouncer_reason: string | null
          bouncer_status: string | null
          company_city: string | null
          company_group_id: string | null
          company_name: string | null
          company_sector: string | null
          company_siren: string | null
          company_size: string | null
          created_at: string | null
          deleted_at: string | null
          deliverability_checked_at: string | null
          deliverability_provider: string | null
          deliverability_reason: string | null
          deliverability_status: string | null
          email: string | null
          email_source: string | null
          email_validation_status: string | null
          enrichment_data: Json | null
          first_name: string
          id: string
          instagram_url: string | null
          job_title: string | null
          last_name: string
          linkedin_url: string | null
          more_available_counts: Json | null
          notes: string | null
          persona_id: string
          phone: string | null
          qualification_score: number | null
          smartlead_push_decision: string | null
          smartlead_push_reason: string | null
          source_signal_id: string | null
          status: string
          tiktok_url: string | null
          twitter_url: string | null
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          bouncer_checked_at?: string | null
          bouncer_reason?: string | null
          bouncer_status?: string | null
          company_city?: string | null
          company_group_id?: string | null
          company_name?: string | null
          company_sector?: string | null
          company_siren?: string | null
          company_size?: string | null
          created_at?: string | null
          deleted_at?: string | null
          deliverability_checked_at?: string | null
          deliverability_provider?: string | null
          deliverability_reason?: string | null
          deliverability_status?: string | null
          email?: string | null
          email_source?: string | null
          email_validation_status?: string | null
          enrichment_data?: Json | null
          first_name: string
          id?: string
          instagram_url?: string | null
          job_title?: string | null
          last_name: string
          linkedin_url?: string | null
          more_available_counts?: Json | null
          notes?: string | null
          persona_id: string
          phone?: string | null
          qualification_score?: number | null
          smartlead_push_decision?: string | null
          smartlead_push_reason?: string | null
          source_signal_id?: string | null
          status?: string
          tiktok_url?: string | null
          twitter_url?: string | null
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          bouncer_checked_at?: string | null
          bouncer_reason?: string | null
          bouncer_status?: string | null
          company_city?: string | null
          company_group_id?: string | null
          company_name?: string | null
          company_sector?: string | null
          company_siren?: string | null
          company_size?: string | null
          created_at?: string | null
          deleted_at?: string | null
          deliverability_checked_at?: string | null
          deliverability_provider?: string | null
          deliverability_reason?: string | null
          deliverability_status?: string | null
          email?: string | null
          email_source?: string | null
          email_validation_status?: string | null
          enrichment_data?: Json | null
          first_name?: string
          id?: string
          instagram_url?: string | null
          job_title?: string | null
          last_name?: string
          linkedin_url?: string | null
          more_available_counts?: Json | null
          notes?: string | null
          persona_id?: string
          phone?: string | null
          qualification_score?: number | null
          smartlead_push_decision?: string | null
          smartlead_push_reason?: string | null
          source_signal_id?: string | null
          status?: string
          tiktok_url?: string | null
          twitter_url?: string | null
          updated_at?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_source_signal"
            columns: ["source_signal_id"]
            isOneToOne: false
            referencedRelation: "prospect_signals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospect_profiles_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "icp_personas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospect_profiles_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      prospect_scraping_logs: {
        Row: {
          created_at: string | null
          duration_ms: number | null
          error_message: string | null
          http_status: number | null
          id: string
          metadata: Json | null
          results_count: number | null
          source: string
          status: string
          workspace_id: string
        }
        Insert: {
          created_at?: string | null
          duration_ms?: number | null
          error_message?: string | null
          http_status?: number | null
          id?: string
          metadata?: Json | null
          results_count?: number | null
          source: string
          status: string
          workspace_id: string
        }
        Update: {
          created_at?: string | null
          duration_ms?: number | null
          error_message?: string | null
          http_status?: number | null
          id?: string
          metadata?: Json | null
          results_count?: number | null
          source?: string
          status?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospect_scraping_logs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      prospect_sequences: {
        Row: {
          auto_send: boolean | null
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          persona_id: string | null
          steps: Json
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          auto_send?: boolean | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          persona_id?: string | null
          steps: Json
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          auto_send?: boolean | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          persona_id?: string | null
          steps?: Json
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prospect_sequences_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "icp_personas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospect_sequences_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      prospect_signals: {
        Row: {
          acquisition_method: string
          archived_at: string | null
          company_name: string | null
          created_at: string | null
          detected_at: string | null
          do_not_outreach_reasons: string[] | null
          extracted_data: Json | null
          id: string
          import_id: string | null
          imported_metadata: Json | null
          matched_prospect_id: string | null
          raw_content: string | null
          signal_type: string
          source: string
          source_url: string | null
          status: string
          trigger_id: string | null
          workspace_id: string
        }
        Insert: {
          acquisition_method?: string
          archived_at?: string | null
          company_name?: string | null
          created_at?: string | null
          detected_at?: string | null
          do_not_outreach_reasons?: string[] | null
          extracted_data?: Json | null
          id?: string
          import_id?: string | null
          imported_metadata?: Json | null
          matched_prospect_id?: string | null
          raw_content?: string | null
          signal_type: string
          source: string
          source_url?: string | null
          status?: string
          trigger_id?: string | null
          workspace_id: string
        }
        Update: {
          acquisition_method?: string
          archived_at?: string | null
          company_name?: string | null
          created_at?: string | null
          detected_at?: string | null
          do_not_outreach_reasons?: string[] | null
          extracted_data?: Json | null
          id?: string
          import_id?: string | null
          imported_metadata?: Json | null
          matched_prospect_id?: string | null
          raw_content?: string | null
          signal_type?: string
          source?: string
          source_url?: string | null
          status?: string
          trigger_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospect_signals_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "prospect_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospect_signals_matched_prospect_id_fkey"
            columns: ["matched_prospect_id"]
            isOneToOne: false
            referencedRelation: "prospect_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospect_signals_trigger_id_fkey"
            columns: ["trigger_id"]
            isOneToOne: false
            referencedRelation: "signal_triggers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prospect_signals_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      prospect_templates: {
        Row: {
          available_variables: Json | null
          channel: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
          system_prompt: string
          target_category: string | null
          updated_at: string | null
          user_prompt_template: string
          version: number | null
          workspace_id: string
        }
        Insert: {
          available_variables?: Json | null
          channel?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          system_prompt: string
          target_category?: string | null
          updated_at?: string | null
          user_prompt_template: string
          version?: number | null
          workspace_id: string
        }
        Update: {
          available_variables?: Json | null
          channel?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          system_prompt?: string
          target_category?: string | null
          updated_at?: string | null
          user_prompt_template?: string
          version?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospect_templates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      recruitment_agencies_blacklist: {
        Row: {
          detected_count: number
          first_detected_at: string
          id: string
          last_detected_at: string
          name_display: string | null
          name_normalized: string
          notes: string | null
          source: string
        }
        Insert: {
          detected_count?: number
          first_detected_at?: string
          id?: string
          last_detected_at?: string
          name_display?: string | null
          name_normalized: string
          notes?: string | null
          source: string
        }
        Update: {
          detected_count?: number
          first_detected_at?: string
          id?: string
          last_detected_at?: string
          name_display?: string | null
          name_normalized?: string
          notes?: string | null
          source?: string
        }
        Relationships: []
      }
      signal_triggers: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          elimination_rules: Json
          exclude_intermediaries: boolean
          exclude_keywords: string[]
          geo_filters: Json
          icon: string | null
          id: string
          industry_filters: string[]
          is_active: boolean
          is_default: boolean
          label: string
          search_keywords: string[]
          signal_match_threshold: number
          signal_scoring_prompt: string
          slug: string
          source_types: string[]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          elimination_rules?: Json
          exclude_intermediaries?: boolean
          exclude_keywords?: string[]
          geo_filters?: Json
          icon?: string | null
          id?: string
          industry_filters?: string[]
          is_active?: boolean
          is_default?: boolean
          label: string
          search_keywords?: string[]
          signal_match_threshold?: number
          signal_scoring_prompt: string
          slug: string
          source_types?: string[]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          elimination_rules?: Json
          exclude_intermediaries?: boolean
          exclude_keywords?: string[]
          geo_filters?: Json
          icon?: string | null
          id?: string
          industry_filters?: string[]
          is_active?: boolean
          is_default?: boolean
          label?: string
          search_keywords?: string[]
          signal_match_threshold?: number
          signal_scoring_prompt?: string
          slug?: string
          source_types?: string[]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "signal_triggers_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      smartlead_campaigns: {
        Row: {
          campaign_id: string
          campaign_name: string | null
          created_at: string
          enabled: boolean
          id: string
          persona_id: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          campaign_id: string
          campaign_name?: string | null
          created_at?: string
          enabled?: boolean
          id?: string
          persona_id: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          campaign_id?: string
          campaign_name?: string | null
          created_at?: string
          enabled?: boolean
          id?: string
          persona_id?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "smartlead_campaigns_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "icp_personas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "smartlead_campaigns_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      smartlead_events: {
        Row: {
          campaign_id: number | null
          created_at: string
          email_account: string | null
          event_type: string
          id: string
          lead_email: string | null
          message: string | null
          prospect_id: string | null
          raw_payload: Json | null
          subject: string | null
        }
        Insert: {
          campaign_id?: number | null
          created_at?: string
          email_account?: string | null
          event_type: string
          id?: string
          lead_email?: string | null
          message?: string | null
          prospect_id?: string | null
          raw_payload?: Json | null
          subject?: string | null
        }
        Update: {
          campaign_id?: number | null
          created_at?: string
          email_account?: string | null
          event_type?: string
          id?: string
          lead_email?: string | null
          message?: string | null
          prospect_id?: string | null
          raw_payload?: Json | null
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "smartlead_events_prospect_id_fkey"
            columns: ["prospect_id"]
            isOneToOne: false
            referencedRelation: "prospect_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      validation_errors: {
        Row: {
          created_at: string
          errors: Json
          function_name: string
          id: string
          received_data: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          errors: Json
          function_name: string
          id?: string
          received_data?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          errors?: Json
          function_name?: string
          id?: string
          received_data?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      workspace_brand: {
        Row: {
          app_url: string | null
          attachments: Json
          brand_name: string | null
          created_at: string
          founder_name: string | null
          hero_image_url: string | null
          notification_recipients: string[]
          product_pitch: string | null
          signature: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          app_url?: string | null
          attachments?: Json
          brand_name?: string | null
          created_at?: string
          founder_name?: string | null
          hero_image_url?: string | null
          notification_recipients?: string[]
          product_pitch?: string | null
          signature?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          app_url?: string | null
          attachments?: Json
          brand_name?: string | null
          created_at?: string
          founder_name?: string | null
          hero_image_url?: string | null
          notification_recipients?: string[]
          product_pitch?: string | null
          signature?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_brand_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          invited_by: string | null
          joined_at: string
          role: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          invited_by?: string | null
          joined_at?: string
          role?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          invited_by?: string | null
          joined_at?: string
          role?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_provider_credentials: {
        Row: {
          created_at: string
          encrypted_key: string
          last4: string
          provider_id: string
          set_by: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          encrypted_key: string
          last4: string
          provider_id: string
          set_by?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          encrypted_key?: string
          last4?: string
          provider_id?: string
          set_by?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_provider_credentials_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: true
            referencedRelation: "workspace_providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_provider_credentials_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_providers: {
        Row: {
          category: string
          channel: string | null
          config: Json
          created_at: string
          credential_last4: string | null
          credential_set_at: string | null
          id: string
          is_active: boolean
          last_test_at: string | null
          last_test_detail: string | null
          last_test_status: string | null
          provider_type: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          category: string
          channel?: string | null
          config?: Json
          created_at?: string
          credential_last4?: string | null
          credential_set_at?: string | null
          id?: string
          is_active?: boolean
          last_test_at?: string | null
          last_test_detail?: string | null
          last_test_status?: string | null
          provider_type: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          category?: string
          channel?: string | null
          config?: Json
          created_at?: string
          credential_last4?: string | null
          credential_set_at?: string | null
          id?: string
          is_active?: boolean
          last_test_at?: string | null
          last_test_detail?: string | null
          last_test_status?: string | null
          provider_type?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_providers_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          settings: Json
          slug: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          settings?: Json
          slug?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          settings?: Json
          slug?: string | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      call_poll_prospect_batches: { Args: never; Returns: undefined }
      call_prospect_weekly_recap: { Args: never; Returns: undefined }
      claim_next_enrichment_item: {
        Args: { p_job_id: string }
        Returns: {
          out_attempts: number
          out_item_id: string
          out_signal_id: string
        }[]
      }
      cleanup_old_rate_limits: { Args: never; Returns: undefined }
      cleanup_old_validation_errors: { Args: never; Returns: undefined }
      cleanup_prospect_retention: {
        Args: never
        Returns: {
          profiles_softdeleted_deleted: number
          signals_archived_deleted: number
          signals_dismissed_deleted: number
          signals_raw_deleted: number
        }[]
      }
      complete_enrichment_item: {
        Args: { p_error?: string; p_item_id: string; p_success: boolean }
        Returns: {
          out_job_id: string
          out_remaining: number
        }[]
      }
      compute_pattern_empirical: {
        Args: { window_days?: number }
        Returns: {
          bouncer_invalids: number
          bouncer_total: number
          bounces: number
          domain: string
          pattern_id: string
          replies: number
          sends: number
        }[]
      }
      consume_reoon_credit: { Args: { p_count?: number }; Returns: boolean }
      count_non_sent_messages: {
        Args: { p_channel: string; p_persona_id: string }
        Returns: number
      }
      get_all_companies_progress: { Args: never; Returns: Json }
      get_archived_signals: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: Json
      }
      get_company_name_map: { Args: never; Returns: Json }
      get_effective_tier: { Args: { domain_param: string }; Returns: string }
      get_last_enrichment_run_company_ids: {
        Args: never
        Returns: {
          company_group_id: string
        }[]
      }
      get_prospection_dashboard_stats: { Args: never; Returns: Json }
      increment_crm_detection_attempts: {
        Args: { p_company_group_id: string }
        Returns: undefined
      }
      kill_enrichment_job: {
        Args: { p_job_id: string; p_reason: string }
        Returns: {
          killed_items: number
        }[]
      }
      normalize_agency_name: { Args: { input: string }; Returns: string }
      normalize_company_name_sql: { Args: { p_name: string }; Returns: string }
      search_prospect_companies: {
        Args: { p_limit?: number; p_query: string }
        Returns: Json
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      spawn_bouncer_sweep: {
        Args: { p_functions_url: string; p_service_role_key: string }
        Returns: number
      }
      spawn_enrichment_worker: {
        Args: {
          p_functions_url: string
          p_job_id: string
          p_service_role_key: string
        }
        Returns: number
      }
      trigger_poll_prospect_batches_manual: { Args: never; Returns: string }
      trigger_prospect_weekly_recap_manual: { Args: never; Returns: string }
      user_workspaces: { Args: { min_role?: string }; Returns: string[] }
    }
    Enums: {
      [_ in never]: never
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
  public: {
    Enums: {},
  },
} as const
