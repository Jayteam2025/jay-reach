import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { ProspectionLayout } from '@/components/prospection/ProspectionLayout';
import { Loader2 } from 'lucide-react';

export default function Prospection() {
  const navigate = useNavigate();

  const { data: profile, isLoading, error } = useQuery({
    queryKey: ['prospection-auth-check'],
    queryFn: async () => {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) throw new Error('Not authenticated');
      const { data: profileData, error: profileError } = await supabase
        .from('profiles').select('role, first_name, last_name').eq('id', user.id).single();
      if (profileError) throw profileError;
      if (profileData.role !== 'admin') throw new Error('Not authorized');
      return profileData;
    },
    retry: false,
  });

  useEffect(() => {
    if (error) navigate('/dashboard');
  }, [error, navigate]);

  if (isLoading) return (
    <div className="flex items-center justify-center min-h-screen bg-black">
      <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
    </div>
  );
  if (!profile) return null;
  return <ProspectionLayout />;
}
