import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  LinearProgress,
  Link,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import TravelExploreIcon from '@mui/icons-material/TravelExplore';
import LanguageIcon from '@mui/icons-material/Language';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AiSupplierSearchResult, DiscoveryJob, SupplierSuggestion, getDiscoveryJob, searchSuppliersWithAi } from '../api/supplierSearch';
import { getSupplier } from '../api/suppliers';

type Coords = { latitude: number; longitude: number };

/** Resolves the browser's geolocation once (triggers the native permission prompt if not yet
 * decided). Never rejects the caller's flow - resolves to `undefined` on denial/timeout/absence
 * so search can always proceed, just without a location bias. */
function getBrowserLocationOnce(): Promise<Coords | undefined> {
  if (!('geolocation' in navigator)) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => resolve(undefined),
      { timeout: 8000, maximumAge: 5 * 60 * 1000 },
    );
  });
}

export function SupplierSearchPage() {
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState<AiSupplierSearchResult | null>(null);
  const [selected, setSelected] = useState<SupplierSuggestion | null>(null);
  const [locationStatus, setLocationStatus] = useState<'unknown' | 'requesting' | 'granted' | 'unavailable'>('unknown');
  const [coords, setCoords] = useState<Coords | undefined>(undefined);
  const [locationDialogOpen, setLocationDialogOpen] = useState(false);
  const [manualLocation, setManualLocation] = useState('');

  const detailQuery = useQuery({
    queryKey: ['supplier-detail', selected?.supplierId],
    queryFn: () => getSupplier(selected!.supplierId),
    enabled: !!selected,
  });

  const searchMutation = useMutation({
    mutationFn: (vars: { prompt: string; coords?: Coords; locationOverride?: string }) =>
      searchSuppliersWithAi(vars.prompt, undefined, undefined, vars.coords, vars.locationOverride),
    onSuccess: (data) => {
      setResult(data);
      // Google Maps (the primary discovery source) can't run without a location - the backend
      // still returns whatever DB matches it has, but flags that it needs one to go further.
      setLocationDialogOpen(data.source === 'location-required');
    },
  });

  /** Silently tries browser geolocation (no popup) before submitting - the prompt itself may
   * already contain a location, so this never blocks the initial search. */
  const handleSearch = async () => {
    setLocationStatus('requesting');
    const resolvedCoords = await getBrowserLocationOnce();
    setCoords(resolvedCoords);
    setLocationStatus(resolvedCoords ? 'granted' : 'unavailable');
    searchMutation.mutate({ prompt, coords: resolvedCoords });
  };

  /** "Turn on location" action inside the location-required popup - re-triggers the native
   * browser permission prompt and resubmits the same search once coordinates are available. */
  const handleEnableLocation = async () => {
    setLocationStatus('requesting');
    const resolvedCoords = await getBrowserLocationOnce();
    setCoords(resolvedCoords);
    if (!resolvedCoords) {
      setLocationStatus('unavailable');
      return;
    }
    setLocationStatus('granted');
    setLocationDialogOpen(false);
    searchMutation.mutate({ prompt, coords: resolvedCoords });
  };

  /** "Enter location manually" action inside the popup - resubmits with an explicit location. */
  const handleManualLocationSubmit = () => {
    if (!manualLocation.trim()) return;
    setLocationDialogOpen(false);
    searchMutation.mutate({ prompt, coords, locationOverride: manualLocation.trim() });
  };

  const jobId = result?.job?.id;
  const jobRunning = !!result?.job && result.job.status !== 'completed' && result.job.status !== 'failed';

  const jobQuery = useQuery<DiscoveryJob>({
    queryKey: ['discovery-job', jobId],
    queryFn: () => getDiscoveryJob(jobId!),
    enabled: !!jobId && jobRunning,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'completed' || status === 'failed' ? false : 2000;
    },
  });

  const job: DiscoveryJob | null = jobQuery.data ?? result?.job ?? null;
  const displayedSuppliers: SupplierSuggestion[] =
    job?.status === 'completed' && job.finalResults?.length ? job.finalResults : result?.suppliers ?? [];

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2 }}>
        AI Supplier Search
      </Typography>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack direction="row" spacing={1} alignItems="flex-start">
            <TextField
              label="Describe what you need"
              fullWidth
              multiline
              minRows={2}
              placeholder="e.g. Need 2000 corrugated shipping boxes, double-wall, in Pune, budget around ₹1,50,000, delivery within 3 weeks"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <Button
              variant="contained"
              startIcon={<AutoAwesomeIcon />}
              disabled={!prompt.trim() || searchMutation.isPending || locationStatus === 'requesting'}
              onClick={handleSearch}
              sx={{ whiteSpace: 'nowrap', mt: 1 }}
            >
              Search
            </Button>
          </Stack>
          {locationStatus === 'requesting' && (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
              <CircularProgress size={16} />
              <Typography variant="caption" color="text.secondary">
                Requesting your location (required to search) - allow the browser prompt...
              </Typography>
            </Stack>
          )}
          {locationStatus === 'granted' && (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
              <MyLocationIcon fontSize="small" color="action" />
              <Typography variant="caption" color="text.secondary">
                Using your current location to bias nearby results (a location mentioned in your prompt still takes
                priority).
              </Typography>
            </Stack>
          )}
          {locationStatus === 'unavailable' && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              Location unavailable/denied - mention a location in your prompt for geo-targeted results.
            </Typography>
          )}
        </CardContent>
      </Card>

      <Dialog open={locationDialogOpen} onClose={() => setLocationDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>
          <Stack direction="row" spacing={1} alignItems="center">
            <MyLocationIcon color="primary" />
            <Typography variant="h6" component="span">
              Location needed to find nearby suppliers
            </Typography>
          </Stack>
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Our primary business search (Google Maps) needs a location to find suppliers near you. Your prompt didn't
            mention one and browser location isn't enabled. Turn on location, or type one below.
          </Typography>
          <Button
            fullWidth
            variant="contained"
            startIcon={locationStatus === 'requesting' ? <CircularProgress size={16} color="inherit" /> : <MyLocationIcon />}
            onClick={handleEnableLocation}
            disabled={locationStatus === 'requesting'}
            sx={{ mb: 2 }}
          >
            {locationStatus === 'requesting' ? 'Requesting location...' : 'Turn on my location'}
          </Button>
          <Divider sx={{ mb: 2 }}>or</Divider>
          <TextField
            fullWidth
            size="small"
            label="Enter a city or area"
            placeholder="e.g. Pune, Maharashtra"
            value={manualLocation}
            onChange={(e) => setManualLocation(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleManualLocationSubmit()}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setLocationDialogOpen(false)} color="inherit">
            Cancel
          </Button>
          <Button onClick={handleManualLocationSubmit} variant="outlined" disabled={!manualLocation.trim()}>
            Search with this location
          </Button>
        </DialogActions>
      </Dialog>

      {searchMutation.isPending && (
        <Stack alignItems="center" sx={{ my: 4 }} spacing={1}>
          <CircularProgress size={28} />
          <Typography variant="body2" color="text.secondary">
            Understanding requirement and searching suppliers...
          </Typography>
        </Stack>
      )}

      {searchMutation.isError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Search failed. Please try again.
        </Alert>
      )}

      {result && (
        <>
          <Card sx={{ mb: 2 }}>
            <CardContent>
              <Typography variant="subtitle2" gutterBottom>
                Extracted Requirement
              </Typography>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {result.criteria.product && <Chip label={`Product: ${result.criteria.product}`} />}
                {result.criteria.quantity && <Chip label={`Quantity: ${result.criteria.quantity}`} />}
                {result.criteria.location && <Chip label={`Location: ${result.criteria.location}`} />}
                {result.criteria.budget && <Chip label={`Budget: ${result.criteria.budget}`} />}
                {result.criteria.specifications && (
                  <Chip label={`Specs: ${result.criteria.specifications}`} />
                )}
              </Stack>
            </CardContent>
          </Card>

          {result.source === 'discovery-pending' && job && (
            <Alert
              severity={job.status === 'failed' ? 'error' : job.status === 'completed' ? 'success' : 'info'}
              icon={<TravelExploreIcon />}
              sx={{ mb: 2 }}
            >
              <Box sx={{ mb: 1 }}>{job.progressMessage ?? '🔍 Finding additional suppliers...'}</Box>
              {job.status !== 'completed' && job.status !== 'failed' && <LinearProgress sx={{ mb: 1 }} />}
              {job.queries?.length ? (
                <Box sx={{ mb: 1 }}>
                  <strong>Search queries used:</strong> {job.queries.join(' · ')}
                </Box>
              ) : null}
              {job.status === 'completed' && (
                <Box>
                  Discovered {job.discoveredCount} candidates, {job.qualifiedCount} passed verification and were
                  saved for review (status: pending verification).
                </Box>
              )}
            </Alert>
          )}

          <Divider sx={{ mb: 2 }} />

          <Typography variant="subtitle1" sx={{ mb: 1 }}>
            Ranked Suppliers
          </Typography>
          <Stack spacing={1}>
            {displayedSuppliers.length === 0 && (
              <Typography color="text.secondary">No matching suppliers found.</Typography>
            )}
            {displayedSuppliers.map((s) => (
              <Card key={s.supplierId} variant="outlined">
                <CardActionArea onClick={() => setSelected(s)}>
                  <CardContent>
                    <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                      <Box>
                        <Typography variant="body1">{s.legalName}</Typography>
                        <Typography variant="body2" color="text.secondary">
                          {s.reason}
                        </Typography>
                      </Box>
                      <Chip label={`Score: ${s.score}`} color="primary" />
                    </Stack>
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                      {s.email && !s.email.includes('needs-contact') && (
                        <Chip size="small" label={`Email: ${s.email}`} />
                      )}
                      {s.phone && <Chip size="small" label={`Phone: ${s.phone}`} />}
                      {(s.city || s.state) && (
                        <Chip size="small" label={[s.city, s.state].filter(Boolean).join(', ')} />
                      )}
                      {s.verificationStatus && (
                        <Chip
                          size="small"
                          label={s.verificationStatus.replace('_', ' ')}
                          color={s.verificationStatus === 'verified' ? 'success' : 'default'}
                        />
                      )}
                      {s.website && (
                        <Chip size="small" icon={<LanguageIcon />} label="Has website" variant="outlined" />
                      )}
                    </Stack>
                  </CardContent>
                </CardActionArea>
              </Card>
            ))}
          </Stack>
        </>
      )}

      <Dialog open={!!selected} onClose={() => setSelected(null)} fullWidth maxWidth="sm">
        <DialogTitle>{selected?.legalName}</DialogTitle>
        <DialogContent dividers>
          {detailQuery.isLoading && (
            <Stack alignItems="center" sx={{ my: 2 }}>
              <CircularProgress size={24} />
            </Stack>
          )}
          {selected && (
            <Stack spacing={2}>
              <Box>
                <Typography variant="subtitle2">Match evaluation</Typography>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                  <Chip label={`Score: ${selected.score}`} color="primary" />
                  {selected.verificationStatus && (
                    <Chip
                      size="small"
                      label={selected.verificationStatus.replace('_', ' ')}
                      color={selected.verificationStatus === 'verified' ? 'success' : 'default'}
                    />
                  )}
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {selected.reason}
                </Typography>
              </Box>

              <Divider />

              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  Contact & profile
                </Typography>
                {(() => {
                  const data = detailQuery.data;
                  const email = data?.email && !data.email.includes('needs-contact') ? data.email : undefined;
                  const location = [data?.city, data?.state, data?.country].filter(Boolean).join(', ') || undefined;
                  const hasAnyContact = !!(email || data?.phone || location || data?.address || data?.website || data?.taxId);
                  if (!hasAnyContact) {
                    return (
                      <Typography variant="body2" color="text.secondary">
                        No contact information available for this supplier.
                      </Typography>
                    );
                  }
                  return (
                    <Stack spacing={0.5}>
                      {email && <Typography variant="body2">Email: {email}</Typography>}
                      {data?.phone && <Typography variant="body2">Phone: {data.phone}</Typography>}
                      {data?.address && <Typography variant="body2">Address: {data.address}</Typography>}
                      {location && <Typography variant="body2">Location: {location}</Typography>}
                      {data?.website && (
                        <Typography variant="body2">
                          Website:{' '}
                          <Link href={data.website} target="_blank" rel="noopener noreferrer">
                            {data.website}
                          </Link>
                        </Typography>
                      )}
                      {data?.taxId && <Typography variant="body2">Tax ID / GSTIN: {data.taxId}</Typography>}
                    </Stack>
                  );
                })()}
                <Stack spacing={0.5} sx={{ mt: 0.5 }}>
                  <Typography variant="body2">
                    Status: {detailQuery.data?.status} · Source: {detailQuery.data?.source ?? 'unknown'}
                    {detailQuery.data?.sourceTier ? ` (tier ${detailQuery.data.sourceTier})` : ''}
                  </Typography>
                  {typeof detailQuery.data?.discoveryConfidence === 'number' && (
                    <Typography variant="body2">
                      Dedupe confidence: {detailQuery.data.discoveryConfidence}%
                    </Typography>
                  )}
                  <Typography variant="body2">Rating: {detailQuery.data?.rating ?? 0}</Typography>
                  {!!detailQuery.data?.categories?.length && (
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
                      {detailQuery.data.categories.map((c) => (
                        <Chip key={c.id} size="small" label={c.name} />
                      ))}
                    </Stack>
                  )}
                </Stack>
              </Box>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              if (selected) navigate(`/suppliers?q=${encodeURIComponent(selected.legalName)}`);
              setSelected(null);
            }}
          >
            View in Suppliers
          </Button>
          <Button onClick={() => setSelected(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
