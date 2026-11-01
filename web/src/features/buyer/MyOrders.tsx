import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PackageOpen } from 'lucide-react';
import { Button, Card, StatusPill } from '../../components/ui';
import { EmptyState, ErrorState, Skeleton } from '../../components/states';
import { usd } from '../../lib/utils';
import { useBuyer, useOrders } from './api';
import SignInDialog from './SignInDialog';

const label: Record<string, string> = {
  agreed: 'Price agreed, not paid yet', order_created: 'Waiting for PayPal', authorized: 'Payment held', captured: 'Paid',
  refunded: 'Refunded', voided: 'Hold released', expired: 'Price expired', invoiced: 'PayPal invoice sent',
};

export default function MyOrders() {
  const { data: buyer, isLoading } = useBuyer();
  const [open, setOpen] = useState(false);
  const orders = useOrders(!!buyer?.signedIn);

  return (
    <>
      <h1 className="mb-1 mt-2 text-[clamp(26px,5vw,38px)] font-extrabold leading-[1.15] tracking-tight">My orders</h1>
      {isLoading ? <Skeleton /> : !buyer?.signedIn ? (
        <EmptyState title="Sign in to see your orders" action={<Button onClick={() => setOpen(true)}>Sign in with email</Button>}>
          Optional: you can buy as a guest, and every order has its own link. Sign in with your email to keep your orders in one place.
        </EmptyState>
      ) : orders.isLoading ? <Skeleton /> : orders.isError ? <ErrorState message={(orders.error as Error).message} onRetry={() => void orders.refetch()} /> : (
        <>
          <p className="mb-4 text-mute">Signed in as <b>{buyer.email}</b>. Orders you place while signed in show up here.</p>
          {!orders.data?.orders.length ? (
            <EmptyState icon={<PackageOpen size={22} />} title="No orders yet" action={<Link to="/" className="inline-flex min-h-11 items-center rounded-xl bg-brand px-5 py-2.5 font-bold text-brand-ink no-underline">Browse the shop</Link>}>
              When you agree a price or buy now while signed in, it appears here.
            </EmptyState>
          ) : (
            <ul className="m-0 grid list-none gap-3 p-0" aria-label="Your orders">
              {orders.data.orders.map((o) => (
                <li key={o.id}>
                  <Card className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-bold">{o.productName}{o.qty > 1 ? ` x ${o.qty}` : ''}</div>
                      <div className="text-sm text-mute">{new Date(o.createdAt).toLocaleString()} · {usd(o.totalCents)}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <StatusPill status={o.status} label={label[o.status] ?? o.status} />
                      <Link to={`/order/${o.id}`} className="inline-flex min-h-11 items-center rounded-xl bg-chip px-4 font-bold text-ink no-underline hover:bg-brand-soft">
                        {o.status === 'captured' ? 'View receipt' : 'Open'}<span className="sr"> order for {o.productName}</span>
                      </Link>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <SignInDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
