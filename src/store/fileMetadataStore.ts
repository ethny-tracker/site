import { RootStore } from './rootStore';
import { FileMetadataDatabase, IpfsFileMetadata, SyncState } from '../lib/db';
import { action, autorun, computed, observable, runInAction } from 'mobx';
import IpfsClient from 'ipfs-http-client';

interface SearchParams {
  query: string;
  page: number;
}

interface GetLatestParams {
  page: number;
}

interface UpdateSyncAction {
  inodesSynced: number;
  totalInodes: number;
}

interface UpdateSearchResultsAction {
  data: IpfsFileMetadata[];
  total: number;
}

export class FileMetadataStore {
  // search state

  // results of the search request
  @observable
  public searchResults: IpfsFileMetadata[] = [];

  @observable
  public loadingSearchResults: boolean = false;

  @observable
  public total: number = 0;
  // the number of results to show per page
  public resultsPerPage: number;

  // sync state
  @observable
  public inodesSynced: number = 0;
  @observable
  public totalInodesToSync: number = Infinity;
  @observable
  public syncError: Error | null = null;

  // internal
  private rootStore: RootStore;
  private db: FileMetadataDatabase | undefined;
  private ipfsClient = new IpfsClient(
    'ipfs.infura.io',
    '5001',
    { protocol: 'https' }
  );

  constructor(
    rootStore: RootStore,
    resultsPerPage: number,
    autoSync: boolean = false
  ) {
    this.resultsPerPage = resultsPerPage;
    this.rootStore = rootStore;

    if (autoSync) {
      this.syncWatcher();
    }
  }

  public async getDb(): Promise<FileMetadataDatabase> {
    if (!this.db) {
      this.db = new FileMetadataDatabase(this.ipfsClient);
    }

    return this.db;
  }

  @computed
  public get isDbSynced(): boolean {
    const isSynced = this.inodesSynced === this.totalInodesToSync;
    console.log('isDbSynced:', isSynced);
    return isSynced;
  }

  /**
   * Initialize the store to begin syncing.
   */
  public init(): void {
    const initiator = async () => {
      const db = await this.getDb();
      const syncState = await db.getSyncState();
      this.updateSyncProgress({
        inodesSynced: syncState.numSynced,
        totalInodes: syncState.total
      });

      await db.startSync((err: Error | null, syncState: SyncState) => {
        if (err) {
          console.warn('Error while syncing:', err);
        }
        if (!syncState) {
          throw Error('Result must exist');
        }

        this.updateSyncProgress({
          inodesSynced: syncState.numSynced,
          totalInodes: syncState.total
        });
      });
    };

    initiator().catch(err => {
      console.error('Sync error!', err);
      this.syncError = new Error('Incorrect network!');
    });
  }

  private syncWatcher() {
    autorun(() => {
      if (!this.isDbSynced) {
        console.log('Running store init');
        this.init();
      }
    });
  }

  /**
   * Search for paginated fileMetadata results
   * @param params Search parameters
   */
  public async search(params: SearchParams): Promise<void> {
    const db = await this.getDb();
    const limit = this.resultsPerPage;
    const offset = this.resultsPerPage * (params.page - 1);

    runInAction(() => {
      this.loadingSearchResults = true;
    });
    const searchResults = await db.search(params.query, limit, offset);

    this.updateSearchResults({
      total: searchResults.total,
      data: searchResults.data
    });
  }

  /**
   * Get the latest paginated fileMetadata results
   * @param params Pagination parameters
   */
  public async getLatest(params: GetLatestParams) {
    const db = await this.getDb();
    const limit = this.resultsPerPage;
    const offset = this.resultsPerPage * (params.page - 1);

    runInAction(() => {
      this.loadingSearchResults = true;
    });

    const searchResults = await db.latest(limit, offset);

    console.log('[getLatest]', searchResults);

    this.updateSearchResults({
      total: searchResults.total,
      data: searchResults.data
    });
  }

  /**
   * Clear the internal db and current results
   */
  public async clear() {
    const db = await this.getDb();
    await db.clearData();
    this.clearResults();
  }

  @action('updateSyncProgress')
  private updateSyncProgress(params: UpdateSyncAction): void {
    console.log('updateSyncProgress:', params);
    this.inodesSynced = params.inodesSynced;
    this.totalInodesToSync = params.totalInodes;
  }

  @action('updateSearchResults')
  private updateSearchResults(params: UpdateSearchResultsAction): void {
    console.log('updateSearchResults:', params);
    this.searchResults = params.data;
    console.log(params.total);
    this.total = params.total;
    this.loadingSearchResults = false;
  }

  @action('clearResults')
  private clearResults() {
    console.log('clearResults');

    this.searchResults = [];
    this.totalInodesToSync = Infinity;
    this.inodesSynced = 0;
  }
}
