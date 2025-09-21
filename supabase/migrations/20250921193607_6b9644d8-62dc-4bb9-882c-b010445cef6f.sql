-- Remove the overly permissive policy that allows everyone to view all profiles
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;

-- Create a secure policy that only allows users to view their own profile
CREATE POLICY "Users can view their own profile" 
ON public.profiles 
FOR SELECT 
USING (auth.uid() = user_id);

-- Optional: If you need some profiles to be viewable by others (like public display names),
-- you can add a separate policy for specific use cases. For now, keeping it secure.