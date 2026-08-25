export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      accounts: {
        Row: {
          city: string | null
          country: string | null
          created_at: string
          domain: string | null
          enriched_at: string | null
          enrichment: Json | null
          headcount: number | null
          id: string
          is_customer: boolean
          legal_name: string | null
          linkedin_url: string | null
          locale: string | null
          naf_code: string | null
          name: string
          organization_id: string
          postal_address: Json | null
          postal_address_verified_at: string | null
          postal_address_verified_by: string | null
          postal_code: string | null
          prospecting_opposition: boolean
          resolution_status: Database["public"]["Enums"]["signal_resolution"]
          siren: string | null
        }
        Insert: {
          city?: string | null
          country?: string | null
          created_at?: string
          domain?: string | null
          enriched_at?: string | null
          enrichment?: Json | null
          headcount?: number | null
          id?: string
          is_customer?: boolean
          legal_name?: string | null
          linkedin_url?: string | null
          locale?: string | null
          naf_code?: string | null
          name: string
          organization_id: string
          postal_address?: Json | null
          postal_address_verified_at?: string | null
          postal_address_verified_by?: string | null
          postal_code?: string | null
          prospecting_opposition?: boolean
          resolution_status?: Database["public"]["Enums"]["signal_resolution"]
          siren?: string | null
        }
        Update: {
          city?: string | null
          country?: string | null
          created_at?: string
          domain?: string | null
          enriched_at?: string | null
          enrichment?: Json | null
          headcount?: number | null
          id?: string
          is_customer?: boolean
          legal_name?: string | null
          linkedin_url?: string | null
          locale?: string | null
          naf_code?: string | null
          name?: string
          organization_id?: string
          postal_address?: Json | null
          postal_address_verified_at?: string | null
          postal_address_verified_by?: string | null
          postal_code?: string | null
          prospecting_opposition?: boolean
          resolution_status?: Database["public"]["Enums"]["signal_resolution"]
          siren?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      actions: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          block_reason: string | null
          call_callback_at: string | null
          call_notes: string | null
          call_outcome: Database["public"]["Enums"]["call_outcome"] | null
          channel: Database["public"]["Enums"]["channel_kind"]
          cost_eur: number | null
          created_at: string
          dispatch_after: string | null
          dispatched_at: string | null
          enrollment_id: string
          error: string | null
          id: string
          idempotency_key: string
          organization_id: string
          payload: Json | null
          provider_ref: string | null
          scheduled_for: string | null
          sender_id: string | null
          status: Database["public"]["Enums"]["action_status"]
          step_id: string | null
          template_id: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          block_reason?: string | null
          call_callback_at?: string | null
          call_notes?: string | null
          call_outcome?: Database["public"]["Enums"]["call_outcome"] | null
          channel: Database["public"]["Enums"]["channel_kind"]
          cost_eur?: number | null
          created_at?: string
          dispatch_after?: string | null
          dispatched_at?: string | null
          enrollment_id: string
          error?: string | null
          id?: string
          idempotency_key: string
          organization_id: string
          payload?: Json | null
          provider_ref?: string | null
          scheduled_for?: string | null
          sender_id?: string | null
          status?: Database["public"]["Enums"]["action_status"]
          step_id?: string | null
          template_id?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          block_reason?: string | null
          call_callback_at?: string | null
          call_notes?: string | null
          call_outcome?: Database["public"]["Enums"]["call_outcome"] | null
          channel?: Database["public"]["Enums"]["channel_kind"]
          cost_eur?: number | null
          created_at?: string
          dispatch_after?: string | null
          dispatched_at?: string | null
          enrollment_id?: string
          error?: string | null
          id?: string
          idempotency_key?: string
          organization_id?: string
          payload?: Json | null
          provider_ref?: string | null
          scheduled_for?: string | null
          sender_id?: string | null
          status?: Database["public"]["Enums"]["action_status"]
          step_id?: string | null
          template_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "actions_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "enrollments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "actions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "actions_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "senders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "actions_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "sequence_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "actions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "message_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_events: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          diff: Json | null
          entity_id: string | null
          entity_type: string
          id: string
          organization_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          diff?: Json | null
          entity_id?: string | null
          entity_type: string
          id?: string
          organization_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          diff?: Json | null
          entity_id?: string | null
          entity_type?: string
          id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          approval_policy: Json
          created_at: string
          daily_cap: number | null
          entry_rules: Json
          id: string
          letter_monthly_budget_eur: number | null
          list_id: string | null
          name: string
          organization_id: string
          source_id: string | null
          status: Database["public"]["Enums"]["campaign_status"]
        }
        Insert: {
          approval_policy?: Json
          created_at?: string
          daily_cap?: number | null
          entry_rules?: Json
          id?: string
          letter_monthly_budget_eur?: number | null
          list_id?: string | null
          name: string
          organization_id: string
          source_id?: string | null
          status?: Database["public"]["Enums"]["campaign_status"]
        }
        Update: {
          approval_policy?: Json
          created_at?: string
          daily_cap?: number | null
          entry_rules?: Json
          id?: string
          letter_monthly_budget_eur?: number | null
          list_id?: string | null
          name?: string
          organization_id?: string
          source_id?: string | null
          status?: Database["public"]["Enums"]["campaign_status"]
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_sender_bindings: {
        Row: {
          bound_at: string
          contact_id: string
          sender_id: string
        }
        Insert: {
          bound_at?: string
          contact_id: string
          sender_id: string
        }
        Update: {
          bound_at?: string
          contact_id?: string
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_sender_bindings_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_sender_bindings_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "senders"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          account_id: string | null
          created_at: string
          email: string | null
          email_confidence: number | null
          email_status: Database["public"]["Enums"]["email_status"]
          enriched_at: string | null
          enrichment: Json | null
          first_name: string | null
          id: string
          job_title: string | null
          last_name: string | null
          linkedin_provider_id: string | null
          linkedin_url: string | null
          locale: string | null
          organization_id: string
          persona_id: string | null
          photo_url: string | null
          source_list_id: string | null
          source_signal_id: string | null
          status: Database["public"]["Enums"]["contact_status"]
        }
        Insert: {
          account_id?: string | null
          created_at?: string
          email?: string | null
          email_confidence?: number | null
          email_status?: Database["public"]["Enums"]["email_status"]
          enriched_at?: string | null
          enrichment?: Json | null
          first_name?: string | null
          id?: string
          job_title?: string | null
          last_name?: string | null
          linkedin_provider_id?: string | null
          linkedin_url?: string | null
          locale?: string | null
          organization_id: string
          persona_id?: string | null
          photo_url?: string | null
          source_list_id?: string | null
          source_signal_id?: string | null
          status?: Database["public"]["Enums"]["contact_status"]
        }
        Update: {
          account_id?: string | null
          created_at?: string
          email?: string | null
          email_confidence?: number | null
          email_status?: Database["public"]["Enums"]["email_status"]
          enriched_at?: string | null
          enrichment?: Json | null
          first_name?: string | null
          id?: string
          job_title?: string | null
          last_name?: string | null
          linkedin_provider_id?: string | null
          linkedin_url?: string | null
          locale?: string | null
          organization_id?: string
          persona_id?: string | null
          photo_url?: string | null
          source_list_id?: string | null
          source_signal_id?: string | null
          status?: Database["public"]["Enums"]["contact_status"]
        }
        Relationships: [
          {
            foreignKeyName: "contacts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_persona_id_fkey"
            columns: ["persona_id"]
            isOneToOne: false
            referencedRelation: "personas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_source_list_fk"
            columns: ["source_list_id"]
            isOneToOne: false
            referencedRelation: "lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_source_signal_id_fkey"
            columns: ["source_signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
      credentials: {
        Row: {
          config: Json
          id: string
          last_checked_at: string | null
          last4: string | null
          organization_id: string
          provider_id: string
          secret: string | null
          status: string
          updated_at: string
        }
        Insert: {
          config?: Json
          id?: string
          last_checked_at?: string | null
          last4?: string | null
          organization_id: string
          provider_id: string
          secret?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          config?: Json
          id?: string
          last_checked_at?: string | null
          last4?: string | null
          organization_id?: string
          provider_id?: string
          secret?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "credentials_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_list_entries: {
        Row: {
          created_at: string
          customer_list_id: string
          domain: string | null
          id: string
          name_normalized: string | null
          organization_id: string
          raw_name: string | null
          siren: string | null
        }
        Insert: {
          created_at?: string
          customer_list_id: string
          domain?: string | null
          id?: string
          name_normalized?: string | null
          organization_id: string
          raw_name?: string | null
          siren?: string | null
        }
        Update: {
          created_at?: string
          customer_list_id?: string
          domain?: string | null
          id?: string
          name_normalized?: string | null
          organization_id?: string
          raw_name?: string | null
          siren?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_list_entries_customer_list_id_fkey"
            columns: ["customer_list_id"]
            isOneToOne: false
            referencedRelation: "customer_lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_list_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_lists: {
        Row: {
          created_at: string
          entries_count: number
          id: string
          last_synced_at: string | null
          name: string
          organization_id: string
          source: Database["public"]["Enums"]["customer_list_source"]
        }
        Insert: {
          created_at?: string
          entries_count?: number
          id?: string
          last_synced_at?: string | null
          name: string
          organization_id: string
          source: Database["public"]["Enums"]["customer_list_source"]
        }
        Update: {
          created_at?: string
          entries_count?: number
          id?: string
          last_synced_at?: string | null
          name?: string
          organization_id?: string
          source?: Database["public"]["Enums"]["customer_list_source"]
        }
        Relationships: [
          {
            foreignKeyName: "customer_lists_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      enrollments: {
        Row: {
          campaign_id: string
          contact_id: string
          current_step: number
          ended_at: string | null
          id: string
          list_id: string | null
          next_action_at: string | null
          organization_id: string
          resume_at: string | null
          signal_id: string | null
          started_at: string
          status: Database["public"]["Enums"]["enrollment_status"]
          stop_reason: string | null
        }
        Insert: {
          campaign_id: string
          contact_id: string
          current_step?: number
          ended_at?: string | null
          id?: string
          list_id?: string | null
          next_action_at?: string | null
          organization_id: string
          resume_at?: string | null
          signal_id?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["enrollment_status"]
          stop_reason?: string | null
        }
        Update: {
          campaign_id?: string
          contact_id?: string
          current_step?: number
          ended_at?: string | null
          id?: string
          list_id?: string | null
          next_action_at?: string | null
          organization_id?: string
          resume_at?: string | null
          signal_id?: string | null
          started_at?: string
          status?: Database["public"]["Enums"]["enrollment_status"]
          stop_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "enrollments_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_stats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollments_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollments_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollments_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollments_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
      extension_tokens: {
        Row: {
          created_at: string
          is_active: boolean
          label: string | null
          last_used_at: string | null
          organization_id: string
          token: string
          user_id: string
        }
        Insert: {
          created_at?: string
          is_active?: boolean
          label?: string | null
          last_used_at?: string | null
          organization_id: string
          token: string
          user_id: string
        }
        Update: {
          created_at?: string
          is_active?: boolean
          label?: string | null
          last_used_at?: string | null
          organization_id?: string
          token?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "extension_tokens_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      imports: {
        Row: {
          created_at: string
          file_name: string
          id: string
          list_id: string | null
          mapping: Json | null
          organization_id: string
          rows_merged: number
          rows_total: number
          rows_unique: number
          status: string
        }
        Insert: {
          created_at?: string
          file_name: string
          id?: string
          list_id?: string | null
          mapping?: Json | null
          organization_id: string
          rows_merged?: number
          rows_total?: number
          rows_unique?: number
          status?: string
        }
        Update: {
          created_at?: string
          file_name?: string
          id?: string
          list_id?: string | null
          mapping?: Json | null
          organization_id?: string
          rows_merged?: number
          rows_total?: number
          rows_unique?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "imports_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "imports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          organization_id: string
          role: Database["public"]["Enums"]["membership_role"]
          token: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          organization_id: string
          role?: Database["public"]["Enums"]["membership_role"]
          token?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          organization_id?: string
          role?: Database["public"]["Enums"]["membership_role"]
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      linkedin_action_queue: {
        Row: {
          attempts: number
          contact_id: string | null
          created_at: string
          error_code: string | null
          error_message: string | null
          id: string
          kind: string
          linkedin_url: string
          message_body: string | null
          method: string
          organization_id: string
          processing_started_at: string | null
          scheduled_for: string
          sent_at: string | null
          signal_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          contact_id?: string | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          kind: string
          linkedin_url: string
          message_body?: string | null
          method?: string
          organization_id: string
          processing_started_at?: string | null
          scheduled_for?: string
          sent_at?: string | null
          signal_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          contact_id?: string | null
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          kind?: string
          linkedin_url?: string
          message_body?: string | null
          method?: string
          organization_id?: string
          processing_started_at?: string | null
          scheduled_for?: string
          sent_at?: string | null
          signal_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "linkedin_action_queue_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "linkedin_action_queue_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "linkedin_action_queue_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "signals"
            referencedColumns: ["id"]
          },
        ]
      }
      linkedin_settings: {
        Row: {
          daily_cap: number
          mode: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          daily_cap?: number
          mode?: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          daily_cap?: number
          mode?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "linkedin_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      list_members: {
        Row: {
          added_at: string
          contact_id: string
          list_id: string
          raw_row: Json | null
        }
        Insert: {
          added_at?: string
          contact_id: string
          list_id: string
          raw_row?: Json | null
        }
        Update: {
          added_at?: string
          contact_id?: string
          list_id?: string
          raw_row?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "list_members_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "list_members_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "lists"
            referencedColumns: ["id"]
          },
        ]
      }
      lists: {
        Row: {
          context_note: string
          created_at: string
          id: string
          imported_by: string | null
          name: string
          organization_id: string
          origin: Database["public"]["Enums"]["list_origin"]
          source_file_name: string | null
        }
        Insert: {
          context_note: string
          created_at?: string
          id?: string
          imported_by?: string | null
          name: string
          organization_id: string
          origin: Database["public"]["Enums"]["list_origin"]
          source_file_name?: string | null
        }
        Update: {
          context_note?: string
          created_at?: string
          id?: string
          imported_by?: string | null
          name?: string
          organization_id?: string
          origin?: Database["public"]["Enums"]["list_origin"]
          source_file_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lists_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          created_at: string
          organization_id: string
          role: Database["public"]["Enums"]["membership_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          organization_id: string
          role?: Database["public"]["Enums"]["membership_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["membership_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      message_templates: {
        Row: {
          body: string
          channel: Database["public"]["Enums"]["channel_kind"]
          created_at: string
          created_by: string | null
          id: string
          locale: string
          name: string
          organization_id: string
          parent_id: string | null
          sent_count: number
          subject: string | null
          version: number
        }
        Insert: {
          body: string
          channel: Database["public"]["Enums"]["channel_kind"]
          created_at?: string
          created_by?: string | null
          id?: string
          locale: string
          name: string
          organization_id: string
          parent_id?: string | null
          sent_count?: number
          subject?: string | null
          version?: number
        }
        Update: {
          body?: string
          channel?: Database["public"]["Enums"]["channel_kind"]
          created_at?: string
          created_by?: string | null
          id?: string
          locale?: string
          name?: string
          organization_id?: string
          parent_id?: string | null
          sent_count?: number
          subject?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "message_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_templates_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "message_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          channel: Database["public"]["Enums"]["notification_channel"]
          digest: Database["public"]["Enums"]["notification_digest"]
          enabled: boolean
          event: string
          organization_id: string
          user_id: string
        }
        Insert: {
          channel: Database["public"]["Enums"]["notification_channel"]
          digest?: Database["public"]["Enums"]["notification_digest"]
          enabled?: boolean
          event: string
          organization_id: string
          user_id: string
        }
        Update: {
          channel?: Database["public"]["Enums"]["notification_channel"]
          digest?: Database["public"]["Enums"]["notification_digest"]
          enabled?: boolean
          event?: string
          organization_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          channel: Database["public"]["Enums"]["notification_channel"]
          event: string
          id: string
          organization_id: string
          payload: Json | null
          read_at: string | null
          sent_at: string | null
          user_id: string
        }
        Insert: {
          channel: Database["public"]["Enums"]["notification_channel"]
          event: string
          id?: string
          organization_id: string
          payload?: Json | null
          read_at?: string | null
          sent_at?: string | null
          user_id: string
        }
        Update: {
          channel?: Database["public"]["Enums"]["notification_channel"]
          event?: string
          id?: string
          organization_id?: string
          payload?: Json | null
          read_at?: string | null
          sent_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          default_locale: string
          id: string
          name: string
          slug: string
        }
        Insert: {
          created_at?: string
          default_locale?: string
          id?: string
          name: string
          slug: string
        }
        Update: {
          created_at?: string
          default_locale?: string
          id?: string
          name?: string
          slug?: string
        }
        Relationships: []
      }
      outcomes: {
        Row: {
          action_id: string
          id: string
          occurred_at: string
          raw: Json | null
          type: Database["public"]["Enums"]["outcome_type"]
        }
        Insert: {
          action_id: string
          id?: string
          occurred_at?: string
          raw?: Json | null
          type: Database["public"]["Enums"]["outcome_type"]
        }
        Update: {
          action_id?: string
          id?: string
          occurred_at?: string
          raw?: Json | null
          type?: Database["public"]["Enums"]["outcome_type"]
        }
        Relationships: [
          {
            foreignKeyName: "outcomes_action_id_fkey"
            columns: ["action_id"]
            isOneToOne: false
            referencedRelation: "actions"
            referencedColumns: ["id"]
          },
        ]
      }
      personas: {
        Row: {
          angle: string | null
          channels_priority: string[]
          created_at: string
          default_campaign_id: string | null
          department_patterns: string[]
          description: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string
          scoring_prompt: string | null
          seniority: Database["public"]["Enums"]["seniority_level"] | null
          title_exclusions: string[]
          title_patterns: string[]
        }
        Insert: {
          angle?: string | null
          channels_priority?: string[]
          created_at?: string
          default_campaign_id?: string | null
          department_patterns?: string[]
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          scoring_prompt?: string | null
          seniority?: Database["public"]["Enums"]["seniority_level"] | null
          title_exclusions?: string[]
          title_patterns?: string[]
        }
        Update: {
          angle?: string | null
          channels_priority?: string[]
          created_at?: string
          default_campaign_id?: string | null
          department_patterns?: string[]
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          scoring_prompt?: string | null
          seniority?: Database["public"]["Enums"]["seniority_level"] | null
          title_exclusions?: string[]
          title_patterns?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "personas_default_campaign_fk"
            columns: ["default_campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_stats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personas_default_campaign_fk"
            columns: ["default_campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "personas_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          created_at: string
          endpoint: string
          id: string
          keys: Json | null
          last_used_at: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          endpoint: string
          id?: string
          keys?: Json | null
          last_used_at?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          endpoint?: string
          id?: string
          keys?: Json | null
          last_used_at?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      senders: {
        Row: {
          business_hours: Json | null
          created_at: string
          daily_quota: number | null
          display_name: string | null
          hourly_quota: number | null
          id: string
          identity: string
          is_active: boolean
          kind: Database["public"]["Enums"]["sender_kind"]
          organization_id: string
          provider_id: string | null
          timezone: string
          warmup_stage: number
        }
        Insert: {
          business_hours?: Json | null
          created_at?: string
          daily_quota?: number | null
          display_name?: string | null
          hourly_quota?: number | null
          id?: string
          identity: string
          is_active?: boolean
          kind: Database["public"]["Enums"]["sender_kind"]
          organization_id: string
          provider_id?: string | null
          timezone?: string
          warmup_stage?: number
        }
        Update: {
          business_hours?: Json | null
          created_at?: string
          daily_quota?: number | null
          display_name?: string | null
          hourly_quota?: number | null
          id?: string
          identity?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["sender_kind"]
          organization_id?: string
          provider_id?: string | null
          timezone?: string
          warmup_stage?: number
        }
        Relationships: [
          {
            foreignKeyName: "senders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sequence_steps: {
        Row: {
          call_brief: string | null
          campaign_id: string
          channel: Database["public"]["Enums"]["channel_kind"]
          conditions: Json
          delay_hours: number
          id: string
          position: number
          stop_on: string[]
          template_parent_id: string | null
        }
        Insert: {
          call_brief?: string | null
          campaign_id: string
          channel: Database["public"]["Enums"]["channel_kind"]
          conditions?: Json
          delay_hours?: number
          id?: string
          position: number
          stop_on?: string[]
          template_parent_id?: string | null
        }
        Update: {
          call_brief?: string | null
          campaign_id?: string
          channel?: Database["public"]["Enums"]["channel_kind"]
          conditions?: Json
          delay_hours?: number
          id?: string
          position?: number
          stop_on?: string[]
          template_parent_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sequence_steps_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaign_stats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sequence_steps_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sequence_steps_template_parent_id_fkey"
            columns: ["template_parent_id"]
            isOneToOne: false
            referencedRelation: "message_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      signals: {
        Row: {
          account_id: string | null
          company_hint: string | null
          created_at: string
          discard_reason: string | null
          external_id: string
          id: string
          kind: Database["public"]["Enums"]["signal_kind"]
          location: string | null
          occurred_at: string
          organization_id: string
          provider_id: string | null
          raw: Json | null
          resolution_status: Database["public"]["Enums"]["signal_resolution"]
          score: number | null
          score_reason: string | null
          scored_at: string | null
          source_id: string | null
          status: Database["public"]["Enums"]["signal_status"]
          title: string | null
          url: string | null
        }
        Insert: {
          account_id?: string | null
          company_hint?: string | null
          created_at?: string
          discard_reason?: string | null
          external_id: string
          id?: string
          kind: Database["public"]["Enums"]["signal_kind"]
          location?: string | null
          occurred_at: string
          organization_id: string
          provider_id?: string | null
          raw?: Json | null
          resolution_status?: Database["public"]["Enums"]["signal_resolution"]
          score?: number | null
          score_reason?: string | null
          scored_at?: string | null
          source_id?: string | null
          status?: Database["public"]["Enums"]["signal_status"]
          title?: string | null
          url?: string | null
        }
        Update: {
          account_id?: string | null
          company_hint?: string | null
          created_at?: string
          discard_reason?: string | null
          external_id?: string
          id?: string
          kind?: Database["public"]["Enums"]["signal_kind"]
          location?: string | null
          occurred_at?: string
          organization_id?: string
          provider_id?: string | null
          raw?: Json | null
          resolution_status?: Database["public"]["Enums"]["signal_resolution"]
          score?: number | null
          score_reason?: string | null
          scored_at?: string | null
          source_id?: string | null
          status?: Database["public"]["Enums"]["signal_status"]
          title?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "signals_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "signals_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      source_runs: {
        Row: {
          cursor: Json | null
          error: string | null
          finished_at: string | null
          id: string
          items_found: number
          items_new: number
          source_id: string
          started_at: string
          status: string
        }
        Insert: {
          cursor?: Json | null
          error?: string | null
          finished_at?: string | null
          id?: string
          items_found?: number
          items_new?: number
          source_id: string
          started_at?: string
          status?: string
        }
        Update: {
          cursor?: Json | null
          error?: string | null
          finished_at?: string | null
          id?: string
          items_found?: number
          items_new?: number
          source_id?: string
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_runs_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      sources: {
        Row: {
          config: Json
          created_at: string
          id: string
          is_active: boolean
          name: string
          organization_id: string
          provider_id: string
          schedule: string | null
        }
        Insert: {
          config?: Json
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          provider_id: string
          schedule?: string | null
        }
        Update: {
          config?: Json
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          provider_id?: string
          schedule?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sources_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      suppressions: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          organization_id: string
          origin: Database["public"]["Enums"]["suppression_origin"]
          reason: string | null
          scope: Database["public"]["Enums"]["suppression_scope"]
          value: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          organization_id: string
          origin?: Database["public"]["Enums"]["suppression_origin"]
          reason?: string | null
          scope: Database["public"]["Enums"]["suppression_scope"]
          value: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          organization_id?: string
          origin?: Database["public"]["Enums"]["suppression_origin"]
          reason?: string | null
          scope?: Database["public"]["Enums"]["suppression_scope"]
          value?: string
        }
        Relationships: [
          {
            foreignKeyName: "suppressions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      thread_messages: {
        Row: {
          body: string | null
          direction: Database["public"]["Enums"]["thread_direction"]
          headers: Json | null
          id: string
          provider_message_id: string | null
          raw: Json | null
          sent_at: string | null
          thread_id: string
        }
        Insert: {
          body?: string | null
          direction: Database["public"]["Enums"]["thread_direction"]
          headers?: Json | null
          id?: string
          provider_message_id?: string | null
          raw?: Json | null
          sent_at?: string | null
          thread_id: string
        }
        Update: {
          body?: string | null
          direction?: Database["public"]["Enums"]["thread_direction"]
          headers?: Json | null
          id?: string
          provider_message_id?: string | null
          raw?: Json | null
          sent_at?: string | null
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "thread_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "threads"
            referencedColumns: ["id"]
          },
        ]
      }
      threads: {
        Row: {
          assigned_to: string | null
          channel: Database["public"]["Enums"]["channel_kind"]
          classification: Database["public"]["Enums"]["thread_classification"]
          contact_id: string | null
          created_at: string
          id: string
          is_read: boolean
          last_message_at: string | null
          organization_id: string
          provider_thread_id: string | null
          resume_at: string | null
        }
        Insert: {
          assigned_to?: string | null
          channel: Database["public"]["Enums"]["channel_kind"]
          classification?: Database["public"]["Enums"]["thread_classification"]
          contact_id?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          last_message_at?: string | null
          organization_id: string
          provider_thread_id?: string | null
          resume_at?: string | null
        }
        Update: {
          assigned_to?: string | null
          channel?: Database["public"]["Enums"]["channel_kind"]
          classification?: Database["public"]["Enums"]["thread_classification"]
          contact_id?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          last_message_at?: string | null
          organization_id?: string
          provider_thread_id?: string | null
          resume_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "threads_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "threads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      campaign_stats: {
        Row: {
          accepted: number | null
          channels: number | null
          contacted: number | null
          enrolled: number | null
          id: string | null
          invites: number | null
          name: string | null
          organization_id: string | null
          replies: number | null
          sent: number | null
          source_id: string | null
          status: Database["public"]["Enums"]["campaign_status"] | null
        }
        Insert: {
          accepted?: never
          channels?: never
          contacted?: never
          enrolled?: never
          id?: string | null
          invites?: never
          name?: string | null
          organization_id?: string | null
          replies?: never
          sent?: never
          source_id?: string | null
          status?: Database["public"]["Enums"]["campaign_status"] | null
        }
        Update: {
          accepted?: never
          channels?: never
          contacted?: never
          enrolled?: never
          id?: string | null
          invites?: never
          name?: string | null
          organization_id?: string | null
          replies?: never
          sent?: never
          source_id?: string | null
          status?: Database["public"]["Enums"]["campaign_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaigns_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      credentials_public: {
        Row: {
          config: Json | null
          id: string | null
          last_checked_at: string | null
          last4: string | null
          organization_id: string | null
          provider_id: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          config?: Json | null
          id?: string | null
          last_checked_at?: string | null
          last4?: string | null
          organization_id?: string | null
          provider_id?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          config?: Json | null
          id?: string | null
          last_checked_at?: string | null
          last4?: string | null
          organization_id?: string | null
          provider_id?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "credentials_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_invitation: { Args: { p_token: string }; Returns: string }
      create_organization: {
        Args: { p_locale?: string; p_name: string; p_slug: string }
        Returns: string
      }
      search_accounts_trgm: {
        Args: { p_name: string; p_org: string }
        Returns: {
          account_id: string
          name: string
          similarity: number
        }[]
      }
      set_provider_credential: {
        Args: {
          p_config?: Json
          p_key: string
          p_org: string
          p_provider: string
          p_secret: string
        }
        Returns: string
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      action_status:
        | "scheduled"
        | "pending_approval"
        | "blocked"
        | "approved"
        | "dispatched"
        | "delivered"
        | "failed"
        | "skipped"
        | "cancelled"
      call_outcome:
        | "reached"
        | "not_reached"
        | "callback"
        | "wrong_person"
        | "not_interested"
      campaign_status: "draft" | "active" | "paused" | "archived"
      channel_kind:
        | "email"
        | "linkedin_invite"
        | "linkedin_message"
        | "letter"
        | "call"
      contact_status: "active" | "left_company" | "do_not_contact"
      customer_list_source: "csv" | "crm_sync"
      email_status: "unknown" | "valid" | "risky" | "invalid"
      enrollment_status:
        | "active"
        | "paused"
        | "paused_absence"
        | "completed"
        | "stopped"
        | "replied"
        | "bounced"
      list_origin: "import" | "manual" | "filter"
      membership_role: "owner" | "admin" | "operator" | "viewer"
      notification_channel: "email" | "push"
      notification_digest: "instant" | "hourly" | "daily"
      outcome_type:
        | "sent"
        | "opened"
        | "clicked"
        | "replied"
        | "bounced"
        | "invite_accepted"
        | "letter_printed"
        | "letter_delivered"
        | "unsubscribed"
      sender_kind: "email" | "linkedin" | "postal"
      seniority_level: "executive" | "director" | "manager" | "individual"
      signal_kind: "job_posting" | "appointment" | "tradeshow"
      signal_resolution: "pending" | "resolved" | "unresolved" | "rejected"
      signal_status: "new" | "qualified" | "discarded" | "enrolled"
      suppression_origin:
        | "manual"
        | "unsubscribe"
        | "bounce"
        | "customer_import"
        | "sirene_opposition"
        | "api"
      suppression_scope: "email" | "domain" | "linkedin" | "postal" | "account"
      thread_classification:
        | "human_reply"
        | "auto_absence"
        | "auto_left_company"
        | "auto_other"
        | "unclassified"
      thread_direction: "in" | "out"
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
    Enums: {
      action_status: [
        "scheduled",
        "pending_approval",
        "blocked",
        "approved",
        "dispatched",
        "delivered",
        "failed",
        "skipped",
        "cancelled",
      ],
      call_outcome: [
        "reached",
        "not_reached",
        "callback",
        "wrong_person",
        "not_interested",
      ],
      campaign_status: ["draft", "active", "paused", "archived"],
      channel_kind: [
        "email",
        "linkedin_invite",
        "linkedin_message",
        "letter",
        "call",
      ],
      contact_status: ["active", "left_company", "do_not_contact"],
      customer_list_source: ["csv", "crm_sync"],
      email_status: ["unknown", "valid", "risky", "invalid"],
      enrollment_status: [
        "active",
        "paused",
        "paused_absence",
        "completed",
        "stopped",
        "replied",
        "bounced",
      ],
      list_origin: ["import", "manual", "filter"],
      membership_role: ["owner", "admin", "operator", "viewer"],
      notification_channel: ["email", "push"],
      notification_digest: ["instant", "hourly", "daily"],
      outcome_type: [
        "sent",
        "opened",
        "clicked",
        "replied",
        "bounced",
        "invite_accepted",
        "letter_printed",
        "letter_delivered",
        "unsubscribed",
      ],
      sender_kind: ["email", "linkedin", "postal"],
      seniority_level: ["executive", "director", "manager", "individual"],
      signal_kind: ["job_posting", "appointment", "tradeshow"],
      signal_resolution: ["pending", "resolved", "unresolved", "rejected"],
      signal_status: ["new", "qualified", "discarded", "enrolled"],
      suppression_origin: [
        "manual",
        "unsubscribe",
        "bounce",
        "customer_import",
        "sirene_opposition",
        "api",
      ],
      suppression_scope: ["email", "domain", "linkedin", "postal", "account"],
      thread_classification: [
        "human_reply",
        "auto_absence",
        "auto_left_company",
        "auto_other",
        "unclassified",
      ],
      thread_direction: ["in", "out"],
    },
  },
} as const

