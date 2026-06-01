import { Building2, Users, UserCheck, Activity, PhoneCall, Mail, MessageCircle, TrendingUp, TrendingDown } from "lucide-react";

interface PlatformStats {
  totalOrgs: number;
  activeOrgs: number;
  totalUsers: number;
  totalContacts: number;
  usersLast1Day: number;
  usersLast7Days: number;
  usersLast30Days: number;
  callVolume: number;
  emailVolume: number;
  whatsappVolume: number;
}

interface Props {
  stats: PlatformStats;
}

function KpiCard({
  label,
  value,
  subtitle,
  icon: Icon,
  bgIcon: BgIcon,
  colorClass,
  borderClass,
  shadowClass,
}: {
  label: string;
  value: string | number;
  subtitle: string;
  icon: typeof Building2;
  bgIcon: typeof Building2;
  colorClass: string;
  borderClass: string;
  shadowClass: string;
}) {
  return (
    <div
      className={`group relative overflow-hidden rounded-2xl bg-gradient-to-br ${colorClass} border ${borderClass} p-5 text-left transition-all hover:shadow-lg ${shadowClass} hover:-translate-y-1`}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <p className="text-4xl font-extrabold text-foreground">
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
      <p className="text-[11px] text-muted-foreground mt-1">{subtitle}</p>
      <div className="absolute bottom-0 right-0 opacity-[0.07] group-hover:opacity-[0.12] transition-opacity">
        <BgIcon className="h-20 w-20 -mb-3 -mr-3" />
      </div>
    </div>
  );
}

export function PlatformSummaryStats({ stats }: Props) {
  return (
    <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-7">
      <KpiCard
        label="Organizations"
        value={stats.totalOrgs}
        subtitle={`${stats.activeOrgs} active`}
        icon={Building2}
        bgIcon={Building2}
        colorClass="from-primary/15 to-primary/5"
        borderClass="border-primary/20"
        shadowClass="hover:shadow-primary/10"
      />
      <KpiCard
        label="Total Users"
        value={stats.totalUsers}
        subtitle="across all orgs"
        icon={Users}
        bgIcon={Users}
        colorClass="from-sky-500/15 to-sky-500/5"
        borderClass="border-sky-500/20"
        shadowClass="hover:shadow-sky-500/10"
      />
      <KpiCard
        label="Active Today"
        value={stats.usersLast1Day}
        subtitle={`${stats.usersLast7Days} this week`}
        icon={UserCheck}
        bgIcon={UserCheck}
        colorClass="from-emerald-500/15 to-emerald-500/5"
        borderClass="border-emerald-500/20"
        shadowClass="hover:shadow-emerald-500/10"
      />
      <KpiCard
        label="Active 30 Days"
        value={stats.usersLast30Days}
        subtitle={`${stats.totalContacts.toLocaleString()} contacts`}
        icon={Activity}
        bgIcon={Activity}
        colorClass="from-violet-500/15 to-violet-500/5"
        borderClass="border-violet-500/20"
        shadowClass="hover:shadow-violet-500/10"
      />
      <KpiCard
        label="Call Volume"
        value={stats.callVolume}
        subtitle="total calls logged"
        icon={PhoneCall}
        bgIcon={PhoneCall}
        colorClass="from-amber-500/15 to-amber-500/5"
        borderClass="border-amber-500/20"
        shadowClass="hover:shadow-amber-500/10"
      />
      <KpiCard
        label="Email Volume"
        value={stats.emailVolume}
        subtitle="total emails sent"
        icon={Mail}
        bgIcon={Mail}
        colorClass="from-rose-500/15 to-rose-500/5"
        borderClass="border-rose-500/20"
        shadowClass="hover:shadow-rose-500/10"
      />
      <KpiCard
        label="WhatsApp Volume"
        value={stats.whatsappVolume}
        subtitle="total messages sent"
        icon={MessageCircle}
        bgIcon={MessageCircle}
        colorClass="from-green-500/15 to-green-500/5"
        borderClass="border-green-500/20"
        shadowClass="hover:shadow-green-500/10"
      />
    </div>
  );
}
