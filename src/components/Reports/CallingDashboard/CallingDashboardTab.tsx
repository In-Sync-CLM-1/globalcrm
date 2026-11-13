import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Phone, Clock, TrendingUp, Users, PhoneCall, CheckCircle, XCircle, Activity } from "lucide-react";
import { useNotification } from "@/hooks/useNotification";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useUrlState } from "@/hooks/useUrlState";

interface AgentStats {
  agent_id: string;
  agent_name: string;
  total_calls: number;
  total_duration: number;
  positive_calls: number;
  negative_calls: number;
  conversion_rate: number;
  avg_call_duration: number;
}

interface DispositionStats {
  disposition_name: string;
  count: number;
  category: string;
}

interface DashboardStats {
  total_calls: number;
  total_duration: number;
  avg_duration: number;
  total_agents: number;
  positive_rate: number;
}

interface User {
  id: string;
  first_name: string;
  last_name: string;
}

export default function CallingDashboardTab() {
  const [agentStats, setAgentStats] = useState<AgentStats[]>([]);
  const [dispositionStats, setDispositionStats] = useState<DispositionStats[]>([]);
  const [dashboardStats, setDashboardStats] = useState<DashboardStats>({
    total_calls: 0,
    total_duration: 0,
    avg_duration: 0,
    total_agents: 0,
    positive_rate: 0,
  });
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState("7");
  const [selectedUser, setSelectedUser] = useUrlState<string>("cduser", "all");
  const [users, setUsers] = useState<User[]>([]);
  const [teamMemberIds, setTeamMemberIds] = useState<string[]>([]);
  const [activeCallsCount, setActiveCallsCount] = useState(0);
  const notify = useNotification();

  useEffect(() => {
    fetchUsers();
  }, []);

  useEffect(() => {
    if (selectedUser !== "all") {
      fetchTeamMembers(selectedUser);
    } else {
      setTeamMemberIds([]);
    }
  }, [selectedUser]);

  useEffect(() => {
    fetchDashboardData();
    fetchActiveCalls();
  }, [timeRange, selectedUser, teamMemberIds]);

  const fetchActiveCalls = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase.from("profiles").select("org_id").eq("id", user.id).single();
      if (!profile?.org_id) return;

      const { count } = await supabase
        .from("agent_call_sessions")
        .select("*", { count: "exact", head: true })
        .eq("org_id", profile.org_id)
        .in("status", ["initiating", "ringing", "connected"]);

      setActiveCallsCount(count || 0);
    } catch (error) {
      console.error("Error fetching active calls:", error);
    }
  };

  const fetchUsers = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data: profile } = await supabase
        .from("profiles")
        .select("org_id")
        .eq("id", user.id)
        .single();

      if (!profile?.org_id) throw new Error("Organization not found");

      const { data, error } = await supabase
        .from("profiles")
        .select("id, first_name, last_name")
        .eq("org_id", profile.org_id)
        .order("first_name");

      if (error) throw error;
      setUsers(data || []);
    } catch (error: any) {
      notify.error("Error loading users", error);
    }
  };

  const fetchTeamMembers = async (userId: string) => {
    try {
      const { data: managedTeams } = await supabase
        .from("teams")
        .select("id")
        .eq("manager_id", userId);

      if (managedTeams && managedTeams.length > 0) {
        const { data: teamMembers } = await supabase
          .from("team_members")
          .select("user_id")
          .in("team_id", managedTeams.map(t => t.id));

        if (teamMembers) {
          const memberIds = teamMembers.map(tm => tm.user_id);
          setTeamMemberIds([userId, ...memberIds]);
          return;
        }
      }

      setTeamMemberIds([userId]);
    } catch (error: any) {
      notify.error("Error loading team", error);
      setTeamMemberIds([userId]);
    }
  };

  const fetchDashboardData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data: profile } = await supabase
        .from("profiles")
        .select("org_id")
        .eq("id", user.id)
        .single();

      if (!profile?.org_id) throw new Error("Organization not found");

      const daysAgo = new Date();
      daysAgo.setDate(daysAgo.getDate() - parseInt(timeRange));

      let callLogsQuery = supabase
        .from("call_logs")
        .select(`
          *,
          profiles!call_logs_agent_id_fkey(id, first_name, last_name),
          call_dispositions(name, category)
        `)
        .eq("org_id", profile.org_id)
        .gte("created_at", daysAgo.toISOString())
        .not("conversation_duration", "is", null);

      if (selectedUser !== "all" && teamMemberIds.length > 0) {
        callLogsQuery = callLogsQuery.in("agent_id", teamMemberIds);
      }

      const { data: callLogs, error: callLogsError } = await callLogsQuery;
      if (callLogsError) throw callLogsError;

      const activities = callLogs?.map(log => ({
        ...log,
        created_by: log.agent_id,
        call_duration: log.conversation_duration,
      })) || [];

      const totalCalls = activities?.length || 0;
      const totalDuration = activities?.reduce((sum, a) => sum + (a.call_duration || 0), 0) || 0;
      const avgDuration = totalCalls > 0 ? Math.round(totalDuration / totalCalls) : 0;
      
      const uniqueAgents = new Set(activities?.map(a => a.created_by).filter(Boolean));
      const totalAgents = uniqueAgents.size;

      const positiveCallsCount = activities?.filter(a => 
        a.call_dispositions?.category === "positive"
      ).length || 0;
      const positiveRate = totalCalls > 0 ? Math.round((positiveCallsCount / totalCalls) * 100) : 0;

      setDashboardStats({
        total_calls: totalCalls,
        total_duration: totalDuration,
        avg_duration: avgDuration,
        total_agents: totalAgents,
        positive_rate: positiveRate,
      });

      const agentMap = new Map<string, AgentStats>();
      
      activities?.forEach((activity: any) => {
        if (!activity.created_by || !activity.profiles) return;
        
        const agentId = activity.created_by;
        const agentName = `${activity.profiles.first_name} ${activity.profiles.last_name}`;
        
        if (!agentMap.has(agentId)) {
          agentMap.set(agentId, {
            agent_id: agentId,
            agent_name: agentName,
            total_calls: 0,
            total_duration: 0,
            positive_calls: 0,
            negative_calls: 0,
            conversion_rate: 0,
            avg_call_duration: 0,
          });
        }
        
        const stats = agentMap.get(agentId)!;
        stats.total_calls++;
        stats.total_duration += activity.call_duration || 0;
        
        if (activity.call_dispositions?.category === "positive") {
          stats.positive_calls++;
        } else if (activity.call_dispositions?.category === "negative") {
          stats.negative_calls++;
        }
      });

      const agentStatsArray = Array.from(agentMap.values()).map(stats => ({
        ...stats,
        avg_call_duration: stats.total_calls > 0 
          ? Math.round(stats.total_duration / stats.total_calls) 
          : 0,
        conversion_rate: stats.total_calls > 0 
          ? Math.round((stats.positive_calls / stats.total_calls) * 100) 
          : 0,
      }));

      agentStatsArray.sort((a, b) => b.total_calls - a.total_calls);
      setAgentStats(agentStatsArray);

      const dispositionMap = new Map<string, DispositionStats>();
      
      activities?.forEach((activity: any) => {
        if (!activity.call_dispositions) return;
        
        const dispositionName = activity.call_dispositions.name;
        const category = activity.call_dispositions.category;
        
        if (!dispositionMap.has(dispositionName)) {
          dispositionMap.set(dispositionName, {
            disposition_name: dispositionName,
            count: 0,
            category: category || "neutral",
          });
        }
        
        dispositionMap.get(dispositionName)!.count++;
      });

      const dispositionStatsArray = Array.from(dispositionMap.values());
      dispositionStatsArray.sort((a, b) => b.count - a.count);
      setDispositionStats(dispositionStatsArray);

    } catch (error: any) {
      notify.error("Error loading dashboard", error);
    } finally {
      setLoading(false);
    }
  };

  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m ${secs}s`;
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case "positive":
        return "default";
      case "negative":
        return "destructive";
      case "follow_up":
        return "secondary";
      default:
        return "outline";
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold">Calling Dashboard</h2>
          <p className="text-muted-foreground">Monitor real-time call performance and agent KPIs</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 items-center">
          <Select value={selectedUser} onValueChange={setSelectedUser}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="All Users" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Users</SelectItem>
              {users.map((user) => (
                <SelectItem key={user.id} value={user.id}>
                  {user.first_name} {user.last_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Last 24 Hours</SelectItem>
              <SelectItem value="7">Last 7 Days</SelectItem>
              <SelectItem value="30">Last 30 Days</SelectItem>
              <SelectItem value="90">Last 90 Days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Calls</CardTitle>
            <Activity className="h-4 w-4 text-green-500 animate-pulse" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeCallsCount}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Calls</CardTitle>
            <Phone className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{dashboardStats.total_calls}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Duration</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatDuration(dashboardStats.avg_duration)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{dashboardStats.positive_rate}%</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Agents</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{dashboardStats.total_agents}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Time</CardTitle>
            <PhoneCall className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatDuration(dashboardStats.total_duration)}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Agent Performance Table */}
        <Card>
          <CardHeader>
            <CardTitle>Agent Performance</CardTitle>
            <CardDescription>Individual agent statistics and metrics</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-center text-muted-foreground py-8">Loading...</p>
            ) : agentStats.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No call data available</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Agent</TableHead>
                      <TableHead className="text-center">Calls</TableHead>
                      <TableHead className="text-center">Avg Duration</TableHead>
                      <TableHead className="text-center">Success Rate</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {agentStats.map((agent) => (
                      <TableRow key={agent.agent_id}>
                        <TableCell className="font-medium">{agent.agent_name}</TableCell>
                        <TableCell className="text-center">{agent.total_calls}</TableCell>
                        <TableCell className="text-center">{formatDuration(agent.avg_call_duration)}</TableCell>
                        <TableCell className="text-center">
                          <Badge variant={agent.conversion_rate >= 50 ? "default" : "secondary"}>
                            {agent.conversion_rate}%
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Call Dispositions */}
        <Card>
          <CardHeader>
            <CardTitle>Call Dispositions</CardTitle>
            <CardDescription>Breakdown of call outcomes</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-center text-muted-foreground py-8">Loading...</p>
            ) : dispositionStats.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">No disposition data available</p>
            ) : (
              <div className="space-y-3">
                {dispositionStats.map((disposition) => (
                  <div key={disposition.disposition_name} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {disposition.category === "positive" && <CheckCircle className="h-4 w-4 text-green-500" />}
                      {disposition.category === "negative" && <XCircle className="h-4 w-4 text-red-500" />}
                      <span className="text-sm font-medium">{disposition.disposition_name}</span>
                    </div>
                    <Badge variant={getCategoryColor(disposition.category)}>
                      {disposition.count}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
